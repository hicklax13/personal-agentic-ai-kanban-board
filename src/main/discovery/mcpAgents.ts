import type { DiscoveredMcpServer } from '@shared/types';
import { run } from './proc.js';

/**
 * MCP servers configured in Codex and Hermes, alongside the Claude Code list
 * from `mcp.ts`. Each agent keeps its own server list and its own sign-ins, so
 * every server records which agent owns it — signing in has to happen through
 * that agent for the resulting token to land where the agent will look for it.
 */

/**
 * The command that runs each owner's browser sign-in (OAuth) for one server,
 * all verified from the CLIs' own help:
 *   claude mcp login <name>    "Authenticate with an MCP server (HTTP, SSE, or claude.ai connector)"
 *   codex mcp login <NAME>     "Name of the MCP server to authenticate with oauth"
 *   hermes mcp login --flow browser <name>   "Force re-authentication for an OAuth-based MCP server"
 * Hermes is given `--flow browser` explicitly because its config can default to
 * a device-code flow, which would never open the browser.
 */
export const MCP_SIGN_IN_ARGS: Record<string, (name: string) => string[]> = {
  'claude-code': (name) => ['mcp', 'login', name],
  codex: (name) => ['mcp', 'login', name],
  hermes: (name) => ['mcp', 'login', '--flow', 'browser', name],
};

export const MCP_SIGN_IN_TERMINAL: Record<string, (name: string) => string> = {
  'claude-code': (name) => `claude mcp login ${name}`,
  codex: (name) => `codex mcp login ${name}`,
  hermes: (name) => `hermes mcp login ${name}`,
};

// ---------------------------------------------------------------------------
// Codex — `codex mcp list --json`
// ---------------------------------------------------------------------------

interface CodexMcpEntry {
  name?: unknown;
  enabled?: boolean;
  transport?: { type?: string; url?: string; command?: string };
  auth_status?: string;
}

/**
 * `auth_status` is "unsupported" for servers with no sign-in (verified on this
 * machine); any other value means Codex can run an OAuth sign-in for it.
 */
export function parseCodexMcpJson(raw: unknown): DiscoveredMcpServer[] {
  const list: CodexMcpEntry[] = Array.isArray(raw)
    ? (raw as CodexMcpEntry[])
    : Array.isArray((raw as { servers?: unknown })?.servers)
      ? ((raw as { servers: CodexMcpEntry[] }).servers)
      : [];

  return list
    .filter((e): e is CodexMcpEntry & { name: string } => typeof e.name === 'string')
    .map((e) => {
      const type = e.transport?.type ?? 'unknown';
      const kind: DiscoveredMcpServer['kind'] =
        type === 'stdio' ? 'stdio' : type.includes('http') ? 'http' : type === 'sse' ? 'sse' : 'unknown';
      const auth = e.auth_status ?? 'unsupported';
      const enabled = e.enabled !== false;
      return {
        id: `codex:${e.name}`,
        name: e.name,
        target: e.transport?.url ?? e.transport?.command ?? '',
        kind,
        availability: enabled ? 'available' : 'unavailable',
        statusDetail: enabled
          ? `Enabled in Codex${auth === 'unsupported' ? '' : ` · sign-in: ${auth.replace(/_/g, ' ')}`}`
          : 'Disabled in Codex',
        owner: 'codex',
        ownerName: 'Codex',
        signIn: auth === 'unsupported' ? 'none' : 'oauth',
      };
    });
}

export async function discoverCodexMcp(
  binary: string | null,
): Promise<{ servers: DiscoveredMcpServer[]; warning: string | null }> {
  if (!binary) return { servers: [], warning: null };
  const res = await run(binary, ['mcp', 'list', '--json'], { timeoutMs: 60_000 });
  try {
    return { servers: parseCodexMcpJson(JSON.parse(res.stdout) as unknown), warning: null };
  } catch {
    return { servers: [], warning: 'Could not read the Codex MCP server list.' };
  }
}

// ---------------------------------------------------------------------------
// Hermes — the `mcp_servers:` block of its config.yaml
// ---------------------------------------------------------------------------

/**
 * Read server names, addresses and sign-in type out of Hermes's config.
 *
 * Only `url`, `command`, `auth` and `enabled` are read. `headers` and `env`
 * blocks — where Hermes keeps tokens — are never read, so no credential can
 * reach the window or a log through this path.
 */
export function parseHermesMcpServers(yaml: string): DiscoveredMcpServer[] {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^mcp_servers:\s*$/.test(l));
  if (start === -1) return [];

  const servers: { name: string; url?: string; command?: string; auth?: string; enabled?: boolean }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith(' ')) break; // next top-level key
    const name = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*$/);
    if (name) {
      servers.push({ name: name[1] });
      continue;
    }
    const current = servers[servers.length - 1];
    if (!current) continue;
    const field = line.match(/^ {4}(url|command|auth|enabled):\s*(.+?)\s*$/);
    if (!field) continue;
    const value = field[2].replace(/^["']|["']$/g, '');
    if (field[1] === 'enabled') current.enabled = value.toLowerCase() !== 'false';
    else if (field[1] === 'command') current.command = value.split(/\s+/)[0];
    else if (field[1] === 'url') current.url = value;
    else current.auth = value;
  }

  return servers.map((s) => {
    const enabled = s.enabled !== false;
    const oauth = s.auth?.toLowerCase() === 'oauth';
    const kind: DiscoveredMcpServer['kind'] = s.url ? (s.url.includes('/sse') ? 'sse' : 'http') : 'stdio';
    return {
      id: `hermes:${s.name}`,
      name: s.name,
      target: s.url ?? s.command ?? '',
      kind,
      availability: enabled ? 'available' : 'unavailable',
      statusDetail: enabled
        ? `Configured in Hermes${oauth ? ' · signs in with OAuth' : ''}`
        : 'Disabled in Hermes',
      owner: 'hermes',
      ownerName: 'Hermes',
      signIn: oauth ? 'oauth' : 'none',
    };
  });
}
