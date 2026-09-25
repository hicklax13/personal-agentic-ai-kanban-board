import { promises as fs } from 'node:fs';
import type { DiscoveredAgent, DiscoveryReport, EndpointSettings } from '@shared/types';
import {
  CLAUDE_PLUGIN_CACHE_DIR,
  CLAUDE_SETTINGS_PATH,
  CLAUDE_SKILLS_DIR,
  discoverAgents,
  findHermesConfig,
} from './agents.js';
import { discoverMcpServers } from './mcp.js';
import { discoverCodexMcp, parseHermesMcpServers } from './mcpAgents.js';
import { buildProviders, type SecretGetter } from './catalog.js';
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
  /** Reads a stored credential; used to list each provider's models live. */
  getSecret: SecretGetter;
  cwd: string;
}

async function hermesConfigPath(agents: DiscoveredAgent[]): Promise<string | null> {
  const hermes = agents.find((a) => a.id === 'hermes');
  return hermes ? findHermesConfig(hermes) : null;
}

/**
 * Re-read every provider's model list and effort levels, and nothing else.
 *
 * A full scan health-checks every MCP server and can take minutes; this takes
 * seconds, which is what saving a new API key should cost.
 */
export async function refreshProviders(
  report: DiscoveryReport,
  input: DiscoveryInput,
): Promise<DiscoveryReport> {
  const { providers, warnings } = await buildProviders({
    endpoints: input.endpoints,
    getSecret: input.getSecret,
    agents: report.agents,
    hermesConfigPath: await hermesConfigPath(report.agents),
  });
  return {
    ...report,
    providers,
    // Replace only provider warnings; keep the ones the full scan produced.
    warnings: [...report.warnings.filter((w) => !w.startsWith('Hermes is installed but')), ...warnings],
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Scan the machine and produce the single source of truth the UI renders from.
 *
 * The expensive steps (agent probes, MCP health check, skill tree walk, model
 * lists) are kicked off together and awaited once, so a refresh costs roughly
 * the slowest step rather than the sum of them. The MCP health check is the long
 * pole: it dials every configured server.
 */
export async function runDiscovery(input: DiscoveryInput): Promise<DiscoveryReport> {
  const warnings: string[] = [];

  const lmStudioApiKey = await input.getSecret('LM_STUDIO_API_KEY');
  const agents = await discoverAgents({
    ollamaBaseUrl: input.endpoints.ollamaBaseUrl,
    lmStudioBaseUrl: input.endpoints.lmStudioBaseUrl,
    lmStudioApiKey,
  });

  const claudeAgent = agents.find((a) => a.id === 'claude-code');
  const codexAgent = agents.find((a) => a.id === 'codex');
  const hermesAgent = agents.find((a) => a.id === 'hermes');
  const hermesCfgPath = await hermesConfigPath(agents);

  const [claudeMcp, codexMcp, hermesYaml, skills, plugins, catalog, hermesToolsetResult] =
    await Promise.all([
      discoverMcpServers(claudeAgent?.binaryPath ?? null, input.cwd),
      discoverCodexMcp(codexAgent?.binaryPath ?? null),
      hermesCfgPath ? fs.readFile(hermesCfgPath, 'utf8').catch(() => null) : Promise.resolve(null),
      discoverSkills([
        { path: CLAUDE_SKILLS_DIR, source: 'user', maxDepth: 3 },
        { path: CLAUDE_PLUGIN_CACHE_DIR, source: 'plugin', maxDepth: 7 },
      ]),
      discoverPlugins(CLAUDE_SETTINGS_PATH),
      buildProviders({
        endpoints: input.endpoints,
        getSecret: input.getSecret,
        agents,
        hermesConfigPath: hermesCfgPath,
      }),
      discoverHermesToolsets(
        hermesAgent?.availability === 'available' ? hermesAgent.binaryPath : null,
      ),
    ]);

  if (claudeMcp.warning) warnings.push(claudeMcp.warning);
  if (codexMcp.warning) warnings.push(codexMcp.warning);
  if (hermesToolsetResult.warning) warnings.push(hermesToolsetResult.warning);
  warnings.push(...catalog.warnings);

  const hermesMcp = hermesYaml ? parseHermesMcpServers(hermesYaml) : [];
  const mcpServers = [...claudeMcp.servers, ...codexMcp.servers, ...hermesMcp];

  // --- tools -------------------------------------------------------------
  // `mcp__<server>` tool names are a Claude Code convention, so only Claude's
  // own connected servers become selectable tools.
  const tools = [
    ...builtinTools(),
    ...hermesTools(hermesToolsetResult.toolsets),
    ...mcpTools(
      claudeMcp.servers.filter((s) => s.availability === 'available').map((s) => s.id),
    ),
  ];

  if (skills.length === 0) {
    warnings.push('No skills were found under ~/.claude/skills or the plugin cache.');
  }

  return {
    scannedAt: new Date().toISOString(),
    platform: `${process.platform} ${process.arch}`,
    agents,
    providers: catalog.providers,
    mcpServers,
    skills,
    plugins,
    tools,
    warnings,
  };
}
