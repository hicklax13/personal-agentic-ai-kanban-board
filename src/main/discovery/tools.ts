import type { DiscoveredTool } from '@shared/types';

/**
 * The tool names each agent accepts in its allow-list flag.
 *
 * Claude Code's built-in tool names are listed by hand below, because the CLI
 * has no command that lists them; they are passed via `--allowedTools`. Hermes
 * groups its tools into named toolsets passed to `-t`, and those are read from
 * the installed Hermes at startup (see `parseHermesToolsList`). Codex has no
 * per-invocation tool allow-list flag, so it is absent here on purpose —
 * offering a tool picker that silently does nothing would be worse than none.
 *
 * Anything MCP-provided is namespaced `mcp__<server>__<tool>` and is added at
 * discovery time from the live MCP list rather than hard-coded here.
 */

const CLAUDE_CODE_TOOLS: { name: string; description: string }[] = [
  { name: 'Bash', description: 'Run shell commands' },
  { name: 'Read', description: 'Read a file from disk' },
  { name: 'Write', description: 'Create or overwrite a file' },
  { name: 'Edit', description: 'Make a targeted edit to a file' },
  { name: 'Glob', description: 'Find files by pattern' },
  { name: 'Grep', description: 'Search file contents' },
  { name: 'WebFetch', description: 'Fetch a URL' },
  { name: 'WebSearch', description: 'Search the web' },
  { name: 'Agent', description: 'Spawn a subagent' },
  { name: 'NotebookEdit', description: 'Edit a Jupyter notebook' },
  { name: 'TodoWrite', description: 'Maintain a task list' },
];

export function builtinTools(): DiscoveredTool[] {
  return CLAUDE_CODE_TOOLS.map((t) => ({
    id: `claude-code:${t.name}`,
    name: t.name,
    description: t.description,
    agentIds: ['claude-code'],
  }));
}

/** A toolset as reported by `hermes tools list`. */
export interface HermesToolset {
  name: string;
  description: string;
  enabled: boolean;
  source: 'built-in' | 'plugin';
}

/**
 * Parse `hermes tools list` into the toolsets `hermes -t` accepts.
 *
 * Read from the installed Hermes at startup rather than listed by hand. Hermes
 * updates often (two releases in four days while this was built), and an
 * earlier hand-written list here named two toolsets, `email` and `media`, that
 * Hermes does not have. Observed line shapes:
 *   "  ✓ enabled  web  🔍 Web Search & Scraping"
 *   "  ✗ disabled  stt  🎙️ Speech-to-Text"
 * Only the built-in and plugin sections are read. The MCP section after them
 * lists servers, which are not toolsets.
 */
export function parseHermesToolsList(stdout: string): HermesToolset[] {
  const toolsets: HermesToolset[] = [];
  let section: HermesToolset['source'] | null = null;

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^built-in toolsets/i.test(line)) {
      section = 'built-in';
      continue;
    }
    if (/^plugin toolsets/i.test(line)) {
      section = 'plugin';
      continue;
    }
    // Any other header ("MCP servers:") ends the part we understand.
    if (line.endsWith(':')) {
      section = null;
      continue;
    }
    if (!section) continue;

    const m = line.match(/^\S+\s+(enabled|disabled)\s+(\S+)\s*(.*)$/);
    if (!m) continue;
    toolsets.push({
      name: m[2],
      // Drop the leading emoji so the picker shows plain text.
      description: m[3].replace(/^[^\p{L}\p{N}(]+/u, '').trim(),
      enabled: m[1] === 'enabled',
      source: section,
    });
  }
  return toolsets;
}

/** Used only when `hermes tools list` cannot be read: Hermes's own CLI default. */
export const HERMES_FALLBACK_TOOLSETS: HermesToolset[] = [
  { name: 'hermes-cli', description: 'Hermes CLI default toolset', enabled: true, source: 'built-in' },
];

export function hermesTools(toolsets: HermesToolset[]): DiscoveredTool[] {
  return toolsets.map((t) => ({
    id: `hermes:${t.name}`,
    name: t.name,
    description:
      t.description +
      (t.source === 'plugin' ? ' (plugin)' : '') +
      (t.enabled ? '' : ' — disabled in your Hermes settings'),
    agentIds: ['hermes'],
  }));
}

/**
 * Turn discovered MCP servers into selectable tool entries for Claude Code.
 *
 * `mcp__<server>` in `--allowedTools` grants every tool on that server, which
 * is the right granularity here: the app cannot enumerate a server's individual
 * tools without connecting to it, and connecting to 25 servers at card-edit
 * time would be far too slow.
 */
export function mcpTools(serverIds: string[]): DiscoveredTool[] {
  return serverIds.map((id) => ({
    id: `claude-code:mcp__${sanitiseServerId(id)}`,
    name: `mcp__${sanitiseServerId(id)}`,
    description: `All tools exposed by MCP server "${id}"`,
    agentIds: ['claude-code'],
  }));
}

/** Claude Code namespaces MCP tools with non-alphanumerics replaced by underscores. */
export function sanitiseServerId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}
