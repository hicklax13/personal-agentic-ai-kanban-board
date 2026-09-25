import { describe, expect, it } from 'vitest';
import {
  MCP_SIGN_IN_ARGS,
  MCP_SIGN_IN_TERMINAL,
  parseCodexMcpJson,
  parseHermesMcpServers,
} from '../src/main/discovery/mcpAgents.js';
import { parseMcpList } from '../src/main/discovery/mcp.js';

// ---------------------------------------------------------------------------
// Codex — `codex mcp list --json` (real field layout; paths are placeholders)
// ---------------------------------------------------------------------------

const CODEX_MCP = [
  {
    name: 'codex_app',
    enabled: false,
    disabled_reason: null,
    transport: { type: 'stdio', command: 'cmd.exe' },
    auth_status: 'unsupported',
  },
  {
    name: 'node_repl',
    enabled: true,
    transport: { type: 'stdio', command: 'C:/Users/example/node_repl.exe' },
    auth_status: 'unsupported',
  },
  {
    name: 'openaiDeveloperDocs',
    enabled: true,
    transport: { type: 'streamable_http', url: 'https://developers.openai.com/mcp' },
    auth_status: 'unsupported',
  },
  {
    name: 'some-oauth-server',
    enabled: true,
    transport: { type: 'streamable_http', url: 'https://mcp.example.com/mcp' },
    auth_status: 'not_logged_in',
  },
];

describe('parseCodexMcpJson', () => {
  const servers = parseCodexMcpJson(CODEX_MCP);

  it('reads every server and tags it as Codex’s', () => {
    expect(servers.map((s) => s.name)).toEqual([
      'codex_app',
      'node_repl',
      'openaiDeveloperDocs',
      'some-oauth-server',
    ]);
    expect(servers.every((s) => s.owner === 'codex' && s.id.startsWith('codex:'))).toBe(true);
  });

  it('maps transports', () => {
    expect(servers[1].kind).toBe('stdio');
    expect(servers[2].kind).toBe('http');
    expect(servers[2].target).toBe('https://developers.openai.com/mcp');
  });

  it('offers a sign-in only where Codex supports one', () => {
    expect(servers[2].signIn).toBe('none');
    expect(servers[3].signIn).toBe('oauth');
    expect(servers[3].statusDetail).toContain('not logged in');
  });

  it('marks disabled servers as unavailable', () => {
    expect(servers[0].availability).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// Hermes — config.yaml mcp_servers block (placeholder values)
// ---------------------------------------------------------------------------

const HERMES_YAML = `model:
  default: deepseek-flash
mcp_servers:
  playwright:
    command: cmd /c npx @playwright/mcp
    enabled: true
  figma:
    url: https://mcp.figma.com/mcp
    auth: oauth
  browserless:
    url: https://mcp.browserless.io/mcp
    headers:
      Authorization: Bearer PLACEHOLDER
  docker-mcp-gateway:
    url: http://127.0.0.1:8585/sse
  retired:
    url: https://mcp.example.com/mcp
    enabled: false
toolsets:
  - hermes-cli
`;

describe('parseHermesMcpServers', () => {
  const servers = parseHermesMcpServers(HERMES_YAML);

  it('reads every server in the block and stops at the next top-level key', () => {
    expect(servers.map((s) => s.name)).toEqual([
      'playwright',
      'figma',
      'browserless',
      'docker-mcp-gateway',
      'retired',
    ]);
  });

  it('offers a sign-in only for servers configured with auth: oauth', () => {
    expect(servers.find((s) => s.name === 'figma')?.signIn).toBe('oauth');
    expect(servers.find((s) => s.name === 'browserless')?.signIn).toBe('none');
  });

  it('never reads header values, where Hermes keeps tokens', () => {
    expect(JSON.stringify(servers)).not.toContain('PLACEHOLDER');
    expect(JSON.stringify(servers)).not.toContain('Bearer');
  });

  it('keeps only the program name of a command', () => {
    expect(servers[0]).toMatchObject({ kind: 'stdio', target: 'cmd' });
  });

  it('tells SSE from plain HTTP', () => {
    expect(servers.find((s) => s.name === 'docker-mcp-gateway')?.kind).toBe('sse');
  });

  it('marks a disabled server as unavailable', () => {
    expect(servers.find((s) => s.name === 'retired')?.availability).toBe('unavailable');
  });

  it('returns nothing when there is no mcp_servers block', () => {
    expect(parseHermesMcpServers('model:\n  default: x\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Claude — owner fields on the existing parser
// ---------------------------------------------------------------------------

describe('parseMcpList owner fields', () => {
  const servers = parseMcpList(
    'plugin:vercel:vercel: https://mcp.vercel.com (HTTP) - ! Needs authentication\n' +
      'plugin:playwright:playwright: npx @playwright/mcp@latest - ✔ Connected\n',
  );

  it('tags Claude’s servers as Claude Code’s', () => {
    expect(servers.every((s) => s.owner === 'claude-code')).toBe(true);
  });

  it('offers a sign-in for remote servers and not for local programs', () => {
    expect(servers[0].signIn).toBe('oauth');
    expect(servers[1].signIn).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Sign-in commands
// ---------------------------------------------------------------------------

describe('MCP sign-in commands', () => {
  it('uses each CLI’s own documented login subcommand', () => {
    expect(MCP_SIGN_IN_ARGS['claude-code']('plugin:vercel:vercel')).toEqual([
      'mcp',
      'login',
      'plugin:vercel:vercel',
    ]);
    expect(MCP_SIGN_IN_ARGS.codex('docs')).toEqual(['mcp', 'login', 'docs']);
  });

  it('forces the browser flow for Hermes so the browser actually opens', () => {
    expect(MCP_SIGN_IN_ARGS.hermes('figma')).toEqual(['mcp', 'login', '--flow', 'browser', 'figma']);
  });

  it('passes the server name as its own argument, never through a shell', () => {
    const args = MCP_SIGN_IN_ARGS.codex('name with spaces && echo x');
    expect(args[args.length - 1]).toBe('name with spaces && echo x');
  });

  it('has a terminal fallback for every owner', () => {
    expect(MCP_SIGN_IN_TERMINAL.hermes('figma')).toBe('hermes mcp login figma');
  });
});
