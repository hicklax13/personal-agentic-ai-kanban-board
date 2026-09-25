import { promises as fs } from 'node:fs';
import type {
  DiscoveredProvider,
  DiscoveryReport,
  EndpointSettings,
} from '@shared/types';
import {
  CLAUDE_PLUGIN_CACHE_DIR,
  CLAUDE_SETTINGS_PATH,
  CLAUDE_SKILLS_DIR,
  CODEX_CONFIG_PATH,
  discoverAgents,
  findHermesConfig,
} from './agents.js';
import { discoverMcpServers } from './mcp.js';
import {
  claudeModels,
  discoverCodexModels,
  discoverLmStudio,
  discoverOllama,
  hermesProviders,
  parseHermesConfig,
} from './models.js';
import { discoverPlugins } from './plugins.js';
import { discoverSkills } from './skills.js';
import {
  builtinTools,
  HERMES_FALLBACK_TOOLSETS,
  hermesTools,
  mcpTools,
  parseHermesToolsList,
  type HermesToolset,
} from './tools.js';
import { run } from './proc.js';

/**
 * Ask the installed Hermes which toolsets it has.
 *
 * PYTHONIOENCODING is pinned because Hermes is a Python program and its list
 * contains emoji: on Windows, a Python process writing to a pipe can fall back
 * to a legacy code page and fail on the first icon it tries to print.
 */
async function discoverHermesToolsets(
  binary: string | null,
): Promise<{ toolsets: HermesToolset[]; warning: string | null }> {
  if (!binary) return { toolsets: [], warning: null };
  const res = await run(binary, ['tools', 'list'], {
    timeoutMs: 120_000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const toolsets = parseHermesToolsList(`${res.stdout}\n${res.stderr}`);
  if (toolsets.length === 0) {
    return {
      toolsets: HERMES_FALLBACK_TOOLSETS,
      warning:
        'Could not read the toolset list from `hermes tools list`, so only the default ' +
        'hermes-cli toolset is offered for Hermes cards.',
    };
  }
  return { toolsets, warning: null };
}

export interface DiscoveryInput {
  endpoints: EndpointSettings;
  lmStudioApiKey: string | null;
  cwd: string;
}

/**
 * Scan the machine and produce the single source of truth the UI renders from.
 *
 * The expensive steps (agent probes, MCP health check, skill tree walk) are
 * kicked off together and awaited once, so a refresh costs roughly the slowest
 * step rather than the sum of them. The MCP health check is the long pole: it
 * dials every configured server.
 */
export async function runDiscovery(input: DiscoveryInput): Promise<DiscoveryReport> {
  const warnings: string[] = [];

  const agents = await discoverAgents({
    ollamaBaseUrl: input.endpoints.ollamaBaseUrl,
    lmStudioBaseUrl: input.endpoints.lmStudioBaseUrl,
    lmStudioApiKey: input.lmStudioApiKey,
  });

  const claudeAgent = agents.find((a) => a.id === 'claude-code');
  const codexAgent = agents.find((a) => a.id === 'codex');
  const hermesAgent = agents.find((a) => a.id === 'hermes');

  const [
    mcpResult,
    skills,
    plugins,
    ollamaProvider,
    lmStudioProvider,
    codexModels,
    hermesCfgPath,
    hermesToolsetResult,
  ] = await Promise.all([
      discoverMcpServers(claudeAgent?.binaryPath ?? null, input.cwd),
      discoverSkills([
        { path: CLAUDE_SKILLS_DIR, source: 'user', maxDepth: 3 },
        { path: CLAUDE_PLUGIN_CACHE_DIR, source: 'plugin', maxDepth: 7 },
      ]),
      discoverPlugins(CLAUDE_SETTINGS_PATH),
      discoverOllama(input.endpoints.ollamaBaseUrl),
      discoverLmStudio(input.endpoints.lmStudioBaseUrl, input.lmStudioApiKey),
      discoverCodexModels(CODEX_CONFIG_PATH),
      hermesAgent ? findHermesConfig(hermesAgent) : Promise.resolve(null),
      discoverHermesToolsets(
        hermesAgent?.availability === 'available' ? hermesAgent.binaryPath : null,
      ),
    ]);

  if (mcpResult.warning) warnings.push(mcpResult.warning);
  if (hermesToolsetResult.warning) warnings.push(hermesToolsetResult.warning);

  // --- providers ---------------------------------------------------------
  const providers: DiscoveredProvider[] = [];

  providers.push({
    id: 'anthropic',
    name: 'Anthropic (via Claude Code)',
    agentIds: ['claude-code'],
    availability: claudeAgent?.availability ?? 'unavailable',
    statusDetail:
      claudeAgent?.availability === 'available'
        ? 'Model is selected with `claude --model`. Aliases always resolve to the current release.'
        : (claudeAgent?.statusDetail ?? 'Claude Code CLI not found.'),
    models: claudeModels(),
    live: false,
  });

  providers.push({
    id: 'openai',
    name: 'OpenAI (via Codex)',
    agentIds: ['codex'],
    availability: codexAgent?.availability ?? 'unavailable',
    statusDetail:
      codexModels.length > 0
        ? `Default model read from ${CODEX_CONFIG_PATH}. Any other model id the CLI accepts can be typed in.`
        : `No model found in ${CODEX_CONFIG_PATH}; type a model id directly.`,
    models: codexModels,
    live: false,
  });

  providers.push(ollamaProvider, lmStudioProvider);

  if (hermesCfgPath) {
    try {
      const yaml = await fs.readFile(hermesCfgPath, 'utf8');
      providers.push(...hermesProviders(parseHermesConfig(yaml)));
    } catch (err) {
      warnings.push(
        `Hermes config at ${hermesCfgPath} could not be read: ${
          err instanceof Error ? err.message : String(err)
        }. Type a model id directly instead.`,
      );
    }
  } else if (hermesAgent?.availability === 'available') {
    warnings.push(
      'Hermes is installed but its config.yaml was not found, so its model list is empty. ' +
        'Leave the model blank to use the Hermes default, or type a model id directly.',
    );
  }

  // --- tools -------------------------------------------------------------
  const tools = [
    ...builtinTools(),
    ...hermesTools(hermesToolsetResult.toolsets),
    ...mcpTools(mcpResult.servers.filter((s) => s.availability === 'available').map((s) => s.id)),
  ];

  if (skills.length === 0) {
    warnings.push('No skills were found under ~/.claude/skills or the plugin cache.');
  }

  return {
    scannedAt: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    agents,
    providers,
    mcpServers: mcpResult.servers,
    skills,
    plugins,
    tools,
    warnings,
  };
}
