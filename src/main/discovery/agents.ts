import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveredAgent } from '@shared/types';
import { findInHashedDir, run, which } from './proc.js';

/**
 * Locate the agent runtimes installed on this machine.
 *
 * Everything here is probe-then-report. No agent is assumed present, and an
 * agent that is installed but cannot authenticate is reported as `degraded`
 * with the remediation spelled out, rather than being hidden — "you need to log
 * in" is far more useful to a user than "not available".
 */

const home = homedir();
const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');

export const CLAUDE_SETTINGS_PATH = join(home, '.claude', 'settings.json');
export const CLAUDE_SKILLS_DIR = join(home, '.claude', 'skills');
export const CLAUDE_PLUGIN_CACHE_DIR = join(home, '.claude', 'plugins', 'cache');
export const CODEX_CONFIG_PATH = join(home, '.codex', 'config.toml');

/** Extra directories to search beyond PATH, because Electron inherits a thinner PATH than a shell. */
const CLAUDE_DIRS = [join(home, '.local', 'bin'), appData ? join(appData, 'npm') : ''].filter(Boolean);
const HERMES_DIRS = [join(localAppData, 'hermes', 'bin')];
const CODEX_HASHED_PARENT = join(localAppData, 'OpenAI', 'Codex', 'bin');

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** First non-empty line of a version banner; these CLIs print extra lines after it. */
function firstLine(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? null;
}

// ---------------------------------------------------------------------------

async function detectClaudeCode(): Promise<DiscoveredAgent> {
  const base: DiscoveredAgent = {
    id: 'claude-code',
    name: 'Claude Code',
    transport: 'cli-subprocess',
    availability: 'unavailable',
    binaryPath: null,
    endpoint: null,
    version: null,
    statusDetail: '',
    remediation: null,
    supportsStreaming: true,
    supportsToolScoping: true,
    supportsMcpScoping: true,
    supportsSkillScoping: false,
    supportsPluginScoping: true,
    supportsSessionResume: true,
    providerIds: ['anthropic'],
  };

  const binary = await which('claude', CLAUDE_DIRS);
  if (!binary) {
    return {
      ...base,
      statusDetail: 'The `claude` CLI was not found on PATH or in ~/.local/bin.',
      remediation: 'Install Claude Code, then restart this app.',
    };
  }

  const res = await run(binary, ['--version'], { timeoutMs: 30_000 });
  const version = firstLine(res.stdout) ?? firstLine(res.stderr);
  if (!res.ok) {
    return {
      ...base,
      binaryPath: binary,
      availability: 'degraded',
      statusDetail: `Found at ${binary} but \`--version\` failed (exit ${res.code ?? 'n/a'}).`,
      remediation: 'Run `claude --version` in a terminal to see the underlying error.',
    };
  }

  return {
    ...base,
    binaryPath: binary,
    version,
    availability: 'available',
    statusDetail:
      `Found at ${binary}. Credentials are only proven by a real call — ` +
      'use Test in Settings to confirm this account can run a prompt.',
    remediation: null,
  };
}

// ---------------------------------------------------------------------------

async function detectCodex(): Promise<DiscoveredAgent> {
  const base: DiscoveredAgent = {
    id: 'codex',
    name: 'OpenAI Codex',
    transport: 'cli-subprocess',
    availability: 'unavailable',
    binaryPath: null,
    endpoint: null,
    version: null,
    statusDetail: '',
    remediation: null,
    supportsStreaming: true,
    supportsToolScoping: false,
    supportsMcpScoping: false,
    supportsSkillScoping: false,
    supportsPluginScoping: false,
    supportsSessionResume: true,
    providerIds: ['openai', 'ollama', 'lmstudio'],
  };

  // Codex installs under a content-hashed directory that changes on update, so
  // glob for it rather than remembering a path. PATH is checked too, in case a
  // standalone npm install is present.
  const binary =
    (await which('codex', [])) ?? (await findInHashedDir(CODEX_HASHED_PARENT, 'codex.exe'));

  if (!binary) {
    return {
      ...base,
      statusDetail: `No codex executable on PATH or under ${CODEX_HASHED_PARENT}.`,
      remediation: 'Install the Codex app or CLI, then refresh discovery.',
    };
  }

  const res = await run(binary, ['--version'], { timeoutMs: 30_000 });
  const version = firstLine(res.stdout) ?? firstLine(res.stderr);
  const authed = await exists(join(home, '.codex', 'auth.json'));

  if (!res.ok) {
    return {
      ...base,
      binaryPath: binary,
      availability: 'degraded',
      statusDetail: `Found at ${binary} but \`--version\` failed (exit ${res.code ?? 'n/a'}).`,
      remediation: 'Run `codex --version` in a terminal to see the underlying error.',
    };
  }

  return {
    ...base,
    binaryPath: binary,
    version,
    availability: authed ? 'available' : 'degraded',
    statusDetail: authed
      ? `Found at ${binary}; ~/.codex/auth.json is present. Plan quota is only proven by a real call.`
      : `Found at ${binary} but ~/.codex/auth.json is missing.`,
    remediation: authed ? null : 'Run `codex login` in a terminal.',
  };
}

// ---------------------------------------------------------------------------

async function detectHermes(): Promise<DiscoveredAgent> {
  const base: DiscoveredAgent = {
    id: 'hermes',
    name: 'Hermes Agent',
    transport: 'cli-subprocess',
    availability: 'unavailable',
    binaryPath: null,
    endpoint: null,
    version: null,
    statusDetail: '',
    remediation: null,
    // `-z/--oneshot` prints only the final answer, so there is nothing to stream.
    supportsStreaming: false,
    supportsToolScoping: true,
    supportsMcpScoping: false,
    supportsSkillScoping: true,
    supportsPluginScoping: false,
    supportsSessionResume: true,
    providerIds: [],
  };

  const binary = await which('hermes', HERMES_DIRS);
  if (!binary) {
    return {
      ...base,
      statusDetail: `The \`hermes\` CLI was not found on PATH or in ${HERMES_DIRS[0]}.`,
      remediation: 'Install Hermes Agent, then refresh discovery.',
    };
  }

  const res = await run(binary, ['--version'], { timeoutMs: 45_000 });
  const banner = `${res.stdout}\n${res.stderr}`;
  const version = firstLine(banner);

  // The banner reports its own install directory, which is where config.yaml lives.
  const installMatch = banner.match(/Install directory:\s*(.+)/);
  const installDir = installMatch ? installMatch[1].trim() : null;

  if (!res.ok) {
    return {
      ...base,
      binaryPath: binary,
      availability: 'degraded',
      statusDetail: `Found at ${binary} but \`--version\` failed (exit ${res.code ?? 'n/a'}).`,
      remediation: 'Run `hermes doctor` in a terminal.',
    };
  }

  return {
    ...base,
    binaryPath: binary,
    version,
    availability: 'available',
    statusDetail: installDir
      ? `Found at ${binary}. Install directory: ${installDir}.`
      : `Found at ${binary}.`,
    remediation: null,
  };
}

/** Candidate locations for the Hermes config.yaml, derived from the version banner. */
export function hermesConfigCandidates(installDir: string | null): string[] {
  const candidates: string[] = [];
  if (installDir) {
    candidates.push(join(installDir, 'config.yaml'));
    // The banner points at the package dir; the config sits one level up.
    candidates.push(join(installDir, '..', 'config.yaml'));
  }
  candidates.push(join(home, '.hermes', 'config.yaml'));
  return candidates;
}

export async function findHermesConfig(agent: DiscoveredAgent): Promise<string | null> {
  const installMatch = agent.statusDetail.match(/Install directory:\s*([^.]+?)\.?$/);
  const installDir = installMatch ? installMatch[1].trim() : null;
  for (const candidate of hermesConfigCandidates(installDir)) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------

async function detectOllama(baseUrl: string): Promise<DiscoveredAgent> {
  const base: DiscoveredAgent = {
    id: 'ollama',
    name: 'Ollama (direct)',
    transport: 'http-rest',
    availability: 'unavailable',
    binaryPath: null,
    endpoint: baseUrl,
    version: null,
    statusDetail: '',
    remediation: null,
    supportsStreaming: true,
    supportsToolScoping: false,
    supportsMcpScoping: false,
    supportsSkillScoping: false,
    supportsPluginScoping: false,
    supportsSessionResume: false,
    providerIds: ['ollama'],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/version`, {
      signal: controller.signal,
    });
    const body = (await res.json()) as { version?: string };
    return {
      ...base,
      availability: 'available',
      version: body.version ?? null,
      statusDetail: `Reachable at ${baseUrl}. No authentication required.`,
    };
  } catch (err) {
    return {
      ...base,
      statusDetail: `Not reachable at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Start Ollama (`ollama serve`) or correct the endpoint in Settings.',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------

async function detectLmStudio(baseUrl: string, apiKey: string | null): Promise<DiscoveredAgent> {
  const base: DiscoveredAgent = {
    id: 'lmstudio',
    name: 'LM Studio (direct)',
    transport: 'http-rest',
    availability: 'unavailable',
    binaryPath: null,
    endpoint: baseUrl,
    version: null,
    statusDetail: '',
    remediation: null,
    supportsStreaming: true,
    supportsToolScoping: false,
    supportsMcpScoping: false,
    supportsSkillScoping: false,
    supportsPluginScoping: false,
    supportsSessionResume: false,
    providerIds: ['lmstudio'],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/models`, {
      headers,
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ...base,
        availability: 'degraded',
        statusDetail: `Server is running at ${baseUrl} but rejected the request (HTTP ${res.status}).`,
        remediation: 'Add LM_STUDIO_API_KEY in Settings.',
      };
    }
    if (!res.ok) {
      return {
        ...base,
        statusDetail: `Unexpected response from ${baseUrl}: HTTP ${res.status}.`,
        remediation: 'Check that the LM Studio local server is enabled.',
      };
    }
    return { ...base, availability: 'available', statusDetail: `Reachable at ${baseUrl}.` };
  } catch (err) {
    return {
      ...base,
      statusDetail: `Not reachable at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Start the LM Studio local server, or correct the endpoint in Settings.',
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------

/**
 * ChatGPT Desktop — deliberately reported as a non-integration.
 *
 * The app is detectable on disk, but it ships no documented local socket, REST
 * endpoint or CLI that a third party may drive. Rather than inventing one, this
 * entry stays permanently "Not Connected" and names Codex as the supported way
 * to reach the same account. It appears in the UI so the gap is visible instead
 * of silently absent.
 */
async function detectChatGptDesktop(): Promise<DiscoveredAgent> {
  const packagesDir = join(localAppData, 'Packages');
  let installed = false;
  try {
    const entries = await fs.readdir(packagesDir);
    installed = entries.some((e) => e.startsWith('OpenAI.ChatGPT-Desktop'));
  } catch {
    installed = false;
  }

  return {
    id: 'chatgpt-desktop',
    name: 'ChatGPT Desktop',
    transport: 'none',
    availability: 'unavailable',
    binaryPath: null,
    endpoint: null,
    version: null,
    statusDetail: installed
      ? 'Installed on this machine, but it exposes no documented local API for third-party apps. Not connected.'
      : 'Not installed, and it exposes no documented local API for third-party apps. Not connected.',
    remediation:
      'No supported integration exists. Use the Codex agent to reach the same OpenAI account.',
    supportsStreaming: false,
    supportsToolScoping: false,
    supportsMcpScoping: false,
    supportsSkillScoping: false,
    supportsPluginScoping: false,
    supportsSessionResume: false,
    providerIds: [],
  };
}

// ---------------------------------------------------------------------------

export async function discoverAgents(endpoints: {
  ollamaBaseUrl: string;
  lmStudioBaseUrl: string;
  lmStudioApiKey: string | null;
}): Promise<DiscoveredAgent[]> {
  // All probes are independent, so run them concurrently: startup cost is the
  // slowest single probe rather than the sum of all six.
  const [claude, codex, hermes, ollama, lmstudio, chatgpt] = await Promise.all([
    detectClaudeCode(),
    detectCodex(),
    detectHermes(),
    detectOllama(endpoints.ollamaBaseUrl),
    detectLmStudio(endpoints.lmStudioBaseUrl, endpoints.lmStudioApiKey),
    detectChatGptDesktop(),
  ]);
  return [claude, codex, hermes, ollama, lmstudio, chatgpt];
}
