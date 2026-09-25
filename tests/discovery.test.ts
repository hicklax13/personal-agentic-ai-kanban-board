import { describe, expect, it } from 'vitest';
import { parseMcpList } from '../src/main/discovery/mcp.js';
import { parseSkillFrontMatter } from '../src/main/discovery/skills.js';
import { parseEnabledPlugins } from '../src/main/discovery/plugins.js';
import {
  hermesProviders,
  parseCodexModel,
  parseHermesConfig,
  parseOllamaTags,
  parseOpenAiModels,
} from '../src/main/discovery/models.js';
import {
  builtinTools,
  hermesTools,
  mcpTools,
  parseHermesToolsList,
  sanitiseServerId,
} from '../src/main/discovery/tools.js';

/**
 * Every fixture below is real output captured from a working install. The only
 * edits are personal folder names, replaced with `example`, and trimming long
 * lists down to representative lines. Testing parsers against invented samples
 * proves nothing — the whole failure mode is real output not looking how you
 * imagined.
 */

// ---------------------------------------------------------------------------
// `claude mcp list` — captured from claude 2.1.240
// ---------------------------------------------------------------------------

const REAL_MCP_LIST = `Checking MCP server health…

[mcp-sdk] SEP-2352: stored OAuth credential has no 'issuer' stamp (pre-upgrade storage or provider not round-tripping the value).
plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✔ Connected
plugin:huggingface-skills:huggingface-skills: https://huggingface.co/mcp?login (HTTP) - ! Needs authentication
plugin:playwright:playwright: npx @playwright/mcp@latest - ✔ Connected
plugin:vercel:vercel: https://mcp.vercel.com (HTTP) - ! Needs authentication
plugin:claude-mem:mcp-search: C:/Users/example/.claude/plugins/cache/thedotmack/claude-mem/10.5.5/scripts/mcp-server.cjs  - ✔ Connected
plugin:telegram:telegram: bun run --cwd C:/Users/example/.claude/plugins/cache/claude-plugins-official/telegram/0.0.7 --shell=bun --silent start - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed
plugin:chrome-devtools-mcp:chrome-devtools: npx chrome-devtools-mcp@1.7.0 - ✔ Connected
plugin:cloudflare:cloudflare-docs: https://docs.mcp.cloudflare.com/mcp (HTTP) - ✔ Connected
plugin:microsoft-docs:microsoft-learn: https://learn.microsoft.com/api/mcp (HTTP) - ✔ Connected
plugin:oh-my-claudecode:t: node C:/Users/example/.claude/skills/oh-my-claudecode-main/bridge/mcp-server.cjs - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed`;

describe('parseMcpList', () => {
  const servers = parseMcpList(REAL_MCP_LIST);

  it('finds every server line and ignores the banner and SDK noise', () => {
    expect(servers).toHaveLength(10);
    expect(servers.some((s) => s.id.startsWith('['))).toBe(false);
    expect(servers.some((s) => s.id === 'Checking')).toBe(false);
  });

  it('keeps colons inside a server id instead of splitting on the first one', () => {
    const github = servers.find((s) => s.id === 'plugin:github:github');
    expect(github).toBeDefined();
    expect(github?.target).toBe('https://api.githubcopilot.com/mcp/');
  });

  it('does not mistake a Windows drive letter for the name separator', () => {
    const mem = servers.find((s) => s.id === 'plugin:claude-mem:mcp-search');
    expect(mem?.target).toContain('C:/Users/example/.claude');
    expect(mem?.kind).toBe('stdio');
  });

  it('does not split a stdio command on its own flags', () => {
    const telegram = servers.find((s) => s.id === 'plugin:telegram:telegram');
    expect(telegram?.target).toContain('--shell=bun --silent start');
    expect(telegram?.availability).toBe('unavailable');
  });

  it('classifies transports', () => {
    expect(servers.find((s) => s.id === 'plugin:vercel:vercel')?.kind).toBe('http');
    expect(servers.find((s) => s.id === 'plugin:playwright:playwright')?.kind).toBe('stdio');
  });

  it('maps the three real status strings to the three availability states', () => {
    expect(servers.find((s) => s.id === 'plugin:github:github')?.availability).toBe('available');
    expect(
      servers.find((s) => s.id === 'plugin:huggingface-skills:huggingface-skills')?.availability,
    ).toBe('degraded');
    expect(servers.find((s) => s.id === 'plugin:oh-my-claudecode:t')?.availability).toBe(
      'unavailable',
    );
  });

  it('strips the type suffix out of the target', () => {
    expect(servers.find((s) => s.id === 'plugin:cloudflare:cloudflare-docs')?.target).toBe(
      'https://docs.mcp.cloudflare.com/mcp',
    );
  });

  it('produces a readable name from a plugin-scoped id', () => {
    expect(servers.find((s) => s.id === 'plugin:microsoft-docs:microsoft-learn')?.name).toBe(
      'microsoft-learn (microsoft-docs)',
    );
  });

  it('returns nothing for empty input rather than throwing', () => {
    expect(parseMcpList('')).toEqual([]);
  });
});

describe('MCP tool naming', () => {
  it('replaces non-alphanumerics the way the CLI namespaces MCP tools', () => {
    expect(sanitiseServerId('plugin:github:github')).toBe('plugin_github_github');
    expect(sanitiseServerId('claude-mem')).toBe('claude_mem');
  });

  it('builds one tool entry per server, scoped to Claude Code', () => {
    const tools = mcpTools(['plugin:github:github']);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('mcp__plugin_github_github');
    expect(tools[0].agentIds).toEqual(['claude-code']);
  });
});

// ---------------------------------------------------------------------------
// Ollama — captured from the live /api/tags response
// ---------------------------------------------------------------------------

const REAL_OLLAMA_TAGS = {
  models: [
    {
      name: 'qwen3:14b',
      details: { parameter_size: '14.8B', context_length: 40960 },
      capabilities: ['completion', 'tools', 'thinking'],
    },
    {
      name: 'qwen3.8:27b',
      details: { parameter_size: '27.3B', context_length: 262144 },
      capabilities: ['completion', 'vision', 'tools', 'thinking'],
    },
    {
      name: 'nomic-embed-text:latest',
      details: { context_length: 2048 },
      capabilities: ['embedding'],
    },
  ],
};

describe('parseOllamaTags', () => {
  it('reads the live model list', () => {
    const models = parseOllamaTags(REAL_OLLAMA_TAGS);
    expect(models.map((m) => m.id)).toEqual([
      'qwen3:14b',
      'qwen3.8:27b',
      'nomic-embed-text:latest',
    ]);
  });

  it('carries context length and capabilities through', () => {
    const models = parseOllamaTags(REAL_OLLAMA_TAGS);
    expect(models[1].contextLength).toBe(262144);
    expect(models[1].capabilities).toContain('vision');
  });

  it('survives a malformed payload', () => {
    expect(parseOllamaTags({})).toEqual([]);
    expect(parseOllamaTags(null)).toEqual([]);
    expect(parseOllamaTags({ models: 'nope' })).toEqual([]);
  });
});

describe('parseOpenAiModels', () => {
  it('reads an OpenAI-compatible model list', () => {
    expect(parseOpenAiModels({ data: [{ id: 'a' }, { id: 'b' }] }).map((m) => m.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns nothing for the LM Studio 401 error body', () => {
    expect(parseOpenAiModels({ error: { message: 'token required' } })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Codex config.toml — captured from ~/.codex/config.toml
// ---------------------------------------------------------------------------

const REAL_CODEX_TOML = `model = "gpt-6-astra"
model_reasoning_effort = "max"
personality = "pragmatic"

service_tier = "default"
[windows]
sandbox = "elevated"

[desktop]
localeOverride = "en-US"
`;

describe('parseCodexModel', () => {
  it('reads the configured default model', () => {
    expect(parseCodexModel(REAL_CODEX_TOML)).toBe('gpt-6-astra');
  });

  it('ignores a `model` key that lives inside a table', () => {
    expect(parseCodexModel('[provider]\nmodel = "not-the-default"\n')).toBeNull();
  });

  it('returns null when nothing is configured', () => {
    expect(parseCodexModel('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hermes config.yaml — captured from the installed Hermes 0.21.3
// ---------------------------------------------------------------------------

const REAL_HERMES_YAML = `model:
  base_url: https://api.deepseek.com/v1
  default: deepseek-flash
  provider: deepseek
  api_mode: chat_completions
providers:
  ollama-local:
    name: Ollama Local
    base_url: http://127.0.0.1:11434/v1
    model: qwen3.8:27b
    discover_models: true
    models:
      qwen3.8:27b: {}
      nomic-embed-text:latest: {}
      qwen3:14b: {}
fallback_providers:
  - provider: commandcode
    model: deepseek/deepseek-v4.1-flash
  - provider: gemini
    model: gemini-3.8-flash
  - provider: anthropic
    model: claude-sonnet-5
toolsets:
  - hermes-cli
agent:
  max_turns: 60
`;

describe('parseHermesConfig', () => {
  const cfg = parseHermesConfig(REAL_HERMES_YAML);

  it('reads the default model and provider', () => {
    expect(cfg.defaultModel).toBe('deepseek-flash');
    expect(cfg.defaultProvider).toBe('deepseek');
  });

  it('reads a provider block, including model ids that contain colons', () => {
    expect(cfg.providers['ollama-local']).toContain('qwen3.8:27b');
    expect(cfg.providers['ollama-local']).toContain('nomic-embed-text:latest');
    expect(cfg.providers['ollama-local']).toContain('qwen3:14b');
  });

  it('reads the fallback chain as provider/model pairs', () => {
    expect(cfg.fallbacks).toEqual([
      { provider: 'commandcode', model: 'deepseek/deepseek-v4.1-flash' },
      { provider: 'gemini', model: 'gemini-3.8-flash' },
      { provider: 'anthropic', model: 'claude-sonnet-5' },
    ]);
  });

  it('does not leak the unrelated top-level keys that follow', () => {
    expect(Object.keys(cfg.providers)).toEqual(['ollama-local']);
  });

  it('returns an empty summary for empty input', () => {
    const empty = parseHermesConfig('');
    expect(empty.defaultModel).toBeNull();
    expect(empty.fallbacks).toEqual([]);
  });
});

describe('hermesProviders', () => {
  const providers = hermesProviders(parseHermesConfig(REAL_HERMES_YAML));

  it('namespaces provider ids so they cannot collide with top-level providers', () => {
    expect(providers.every((p) => p.id.startsWith('hermes:'))).toBe(true);
  });

  it('collects models from the default, the provider blocks and the fallbacks', () => {
    const ids = providers.map((p) => p.id);
    expect(ids).toContain('hermes:deepseek');
    expect(ids).toContain('hermes:ollama-local');
    expect(ids).toContain('hermes:anthropic');
  });

  it('attaches every provider to the hermes agent only', () => {
    expect(providers.every((p) => p.agentIds.length === 1 && p.agentIds[0] === 'hermes')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Skills and plugins
// ---------------------------------------------------------------------------

describe('parseSkillFrontMatter', () => {
  it('reads a simple name and description', () => {
    const out = parseSkillFrontMatter(
      '---\nname: pdf-filler\ndescription: Fills in PDF forms.\n---\n\n# Body\n',
    );
    expect(out.name).toBe('pdf-filler');
    expect(out.description).toBe('Fills in PDF forms.');
  });

  it('reads a folded multi-line description', () => {
    const out = parseSkillFrontMatter(
      '---\nname: big\ndescription: >-\n  First part of it\n  and the second part\n---\n',
    );
    expect(out.description).toBe('First part of it and the second part');
  });

  it('strips surrounding quotes', () => {
    expect(parseSkillFrontMatter('---\nname: "quoted"\n---\n').name).toBe('quoted');
  });

  it('returns nothing when there is no front matter', () => {
    expect(parseSkillFrontMatter('# Just a heading')).toEqual({});
  });
});

describe('parseEnabledPlugins', () => {
  const settings = {
    enabledPlugins: {
      'superpowers@claude-plugins-official': true,
      'perf@awesome-claude-plugins': true,
      'imessage@claude-plugins-official': false,
    },
  };

  it('splits name from marketplace on the last @', () => {
    const plugins = parseEnabledPlugins(settings);
    const superpowers = plugins.find((p) => p.name === 'superpowers');
    expect(superpowers?.marketplace).toBe('claude-plugins-official');
  });

  it('keeps disabled plugins so the UI can grey them out rather than hide them', () => {
    const plugins = parseEnabledPlugins(settings);
    expect(plugins).toHaveLength(3);
    expect(plugins.find((p) => p.name === 'imessage')?.enabled).toBe(false);
  });

  it('handles a settings file with no plugins at all', () => {
    expect(parseEnabledPlugins({})).toEqual([]);
    expect(parseEnabledPlugins(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `hermes tools list` — captured from Hermes 0.21.5, trimmed
// ---------------------------------------------------------------------------

const REAL_HERMES_TOOLS_LIST = `Built-in toolsets (cli):
  ✓ enabled  web  🔍 Web Search & Scraping
  ✓ enabled  browser  🌐 Browser Automation
  ✓ enabled  terminal  💻 Terminal & Processes
  ✓ enabled  file  📁 File Operations
  ✓ enabled  vision  👁️  Vision / Image Analysis
  ✗ disabled  stt  🎙️ Speech-to-Text
  ✓ enabled  computer_use  🖱️  Computer Use (macOS/Windows/Linux)

Plugin toolsets (cli):
  ✓ enabled  a2a  🔌 A2A
  ✓ enabled  weather  🔌 Weather

MCP servers:
  playwright  all tools enabled
  github  all tools enabled`;

describe('parseHermesToolsList', () => {
  const toolsets = parseHermesToolsList(REAL_HERMES_TOOLS_LIST);

  it('reads the built-in and plugin toolsets', () => {
    expect(toolsets.map((t) => t.name)).toEqual([
      'web',
      'browser',
      'terminal',
      'file',
      'vision',
      'stt',
      'computer_use',
      'a2a',
      'weather',
    ]);
  });

  it('stops at the MCP section, whose entries are servers rather than toolsets', () => {
    expect(toolsets.some((t) => t.name === 'playwright' || t.name === 'github')).toBe(false);
  });

  it('records whether each toolset is enabled', () => {
    expect(toolsets.find((t) => t.name === 'stt')?.enabled).toBe(false);
    expect(toolsets.find((t) => t.name === 'web')?.enabled).toBe(true);
  });

  it('strips the leading icon, including emoji that carry a variation selector', () => {
    expect(toolsets.find((t) => t.name === 'vision')?.description).toBe('Vision / Image Analysis');
    expect(toolsets.find((t) => t.name === 'computer_use')?.description).toBe(
      'Computer Use (macOS/Windows/Linux)',
    );
  });

  it('tags plugin toolsets separately from built-in ones', () => {
    expect(toolsets.find((t) => t.name === 'a2a')?.source).toBe('plugin');
    expect(toolsets.find((t) => t.name === 'web')?.source).toBe('built-in');
  });

  it('returns nothing for empty or unrecognised output', () => {
    expect(parseHermesToolsList('')).toEqual([]);
    expect(parseHermesToolsList('Traceback (most recent call last):')).toEqual([]);
  });
});

describe('hermesTools', () => {
  it('namespaces ids and scopes every entry to Hermes', () => {
    const tools = hermesTools(parseHermesToolsList(REAL_HERMES_TOOLS_LIST));
    expect(tools.every((t) => t.id.startsWith('hermes:') && t.agentIds[0] === 'hermes')).toBe(true);
  });

  it('flags a toolset that is disabled in Hermes settings', () => {
    const stt = hermesTools(parseHermesToolsList(REAL_HERMES_TOOLS_LIST)).find((t) => t.name === 'stt');
    expect(stt?.description).toContain('disabled in your Hermes settings');
  });
});

describe('builtinTools', () => {
  it('no longer carries a hand-written Hermes list', () => {
    // Regression guard: the old static list offered `email` and `media`, which
    // are not Hermes toolsets. Hermes entries now come only from its own output.
    const ids = builtinTools().map((t) => t.id);
    expect(ids.some((id) => id.startsWith('hermes:'))).toBe(false);
  });
});
