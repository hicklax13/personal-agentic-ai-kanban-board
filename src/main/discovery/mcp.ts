import type { Availability, DiscoveredMcpServer } from '@shared/types';
import { run } from './proc.js';

/**
 * Parse the output of `claude mcp list`.
 *
 * The CLI has no `--json` flag (verified against claude 2.1.240), so the text
 * form is the only interface available. Keeping the parser pure and separate
 * from the subprocess call means the test suite can pin it against real
 * captured output — the thing most likely to drift when the CLI changes.
 *
 * Observed line shapes:
 *   plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - checkmark Connected
 *   plugin:playwright:playwright: npx @playwright/mcp@latest - checkmark Connected
 *   plugin:vercel:vercel: https://mcp.vercel.com (HTTP) - ! Needs authentication
 *   plugin:discord:discord: bun run --cwd C:/... - x Failed to connect
 */
export function parseMcpList(stdout: string): DiscoveredMcpServer[] {
  const servers: DiscoveredMcpServer[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip the health-check banner and SDK diagnostics noise.
    if (line.startsWith('[') || line.startsWith('Checking')) continue;

    // Status is whatever follows the final " - " separator. Command targets
    // use " --flag" (space-dash-dash), never " - ", so this split is safe.
    const sep = line.lastIndexOf(' - ');
    if (sep === -1) continue;

    const left = line.slice(0, sep).trim();
    const statusText = line.slice(sep + 3).trim();

    // Name is everything before the first colon-followed-by-space. Server names
    // legitimately contain colons (plugin:github:github) but never spaces, and
    // Windows targets like "C:/Users/..." sit on the right of that first break.
    const nameMatch = left.match(/^(\S+?):\s+(.*)$/);
    if (!nameMatch) continue;

    const id = nameMatch[1];
    let target = nameMatch[2].trim();

    let kind: DiscoveredMcpServer['kind'] = 'stdio';
    const kindMatch = target.match(/\((HTTP|SSE|STDIO)\)\s*$/i);
    if (kindMatch && typeof kindMatch.index === 'number') {
      const k = kindMatch[1].toUpperCase();
      kind = k === 'HTTP' ? 'http' : k === 'SSE' ? 'sse' : 'stdio';
      target = target.slice(0, kindMatch.index).trim();
    } else if (/^https?:\/\//i.test(target)) {
      kind = 'http';
    }

    servers.push({
      id,
      name: friendlyName(id),
      target,
      kind,
      availability: statusToAvailability(statusText),
      statusDetail: statusText,
      owner: 'claude-code',
      ownerName: 'Claude Code',
      // `claude mcp login` handles HTTP, SSE and claude.ai connector servers;
      // a stdio server is a local program with nothing to sign in to.
      signIn: kind === 'stdio' ? 'none' : 'oauth',
    });
  }

  return servers;
}

function statusToAvailability(status: string): Availability {
  const s = status.toLowerCase();
  if (s.includes('connected') && !s.includes('failed')) return 'available';
  if (s.includes('needs authentication') || s.includes('pending approval')) return 'degraded';
  if (s.includes('failed') || s.includes('error')) return 'unavailable';
  return 'degraded';
}

/** `plugin:cloudflare:cloudflare-docs` reads better as `cloudflare-docs (cloudflare)`. */
function friendlyName(id: string): string {
  const parts = id.split(':');
  if (parts.length >= 3 && parts[0] === 'plugin') {
    return `${parts.slice(2).join(':')} (${parts[1]})`;
  }
  return id;
}

/**
 * Ask the Claude CLI which MCP servers exist.
 *
 * This health-checks every server, so it is slow (tens of seconds on a machine
 * with many remote servers). Discovery runs it once at startup and on explicit
 * refresh, never on the hot path.
 */
export async function discoverMcpServers(
  claudeBinary: string | null,
  cwd: string,
): Promise<{ servers: DiscoveredMcpServer[]; warning: string | null }> {
  if (!claudeBinary) {
    return {
      servers: [],
      warning: 'MCP discovery skipped: the Claude Code CLI was not found on this machine.',
    };
  }

  const res = await run(claudeBinary, ['mcp', 'list'], { cwd, timeoutMs: 120_000 });
  const text = `${res.stdout}\n${res.stderr}`;
  const servers = parseMcpList(text);

  if (servers.length === 0) {
    return {
      servers,
      warning: res.timedOut
        ? 'MCP discovery timed out after 120s; the server list is empty for this session.'
        : `MCP discovery returned no servers (exit ${res.code ?? 'n/a'}).`,
    };
  }
  return { servers, warning: null };
}
