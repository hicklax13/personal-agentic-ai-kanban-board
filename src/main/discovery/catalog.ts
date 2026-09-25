import { promises as fs } from 'node:fs';
import type {
  DiscoveredAgent,
  DiscoveredModel,
  DiscoveredProvider,
  EndpointSettings,
  SecretKey,
} from '@shared/types';
import { AGENT_EFFORTS } from '@shared/runSettings';
import { run } from './proc.js';
import {
  claudeModels,
  discoverCodexModels,
  discoverLmStudio,
  discoverOllama,
  hermesProviders,
  parseHermesConfig,
  parseOpenAiModels,
} from './models.js';
import { CODEX_CONFIG_PATH } from './agents.js';

/**
 * Every provider's model list and effort levels, read live wherever possible.
 *
 * Each list address below was checked before use: called without a key it
 * answers 401/403 (right address, needs a key) or 200 (a public list), never
 * 404. The response shapes come from real responses or from Hermes's own
 * fetchers for the same providers. Nothing is listed from memory: a provider
 * whose list cannot be read says so instead of showing a guessed catalogue.
 */

export type SecretGetter = (key: SecretKey) => Promise<string | null>;

type ListResult = { ok: true; models: DiscoveredModel[] } | { ok: false; error: string };

async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 10_000,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 401 || res.status === 403
            ? `The saved key was rejected (HTTP ${res.status}).`
            : `The model list answered HTTP ${res.status}.`,
      };
    }
    return { ok: true, json: (await res.json()) as unknown };
  } catch (err) {
    return {
      ok: false,
      error: controller.signal.aborted
        ? 'Timed out reading the model list.'
        : err instanceof Error
          ? err.message
          : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function label(name: string | undefined, id: string): string {
  return name && name !== id ? `${name} (${id})` : id;
}

function dedupe(models: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Parsers — pure, and tested against real response shapes
// ---------------------------------------------------------------------------

/** Anthropic `GET /v1/models`: `{ data: [{ id, display_name }] }`. */
export function parseAnthropicModels(raw: unknown): DiscoveredModel[] {
  const data = (raw as { data?: { id?: unknown; display_name?: string }[] })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
    .map((m) => ({ id: m.id, name: label(m.display_name, m.id), contextLength: null, capabilities: [] }));
}

/**
 * Google `GET /v1beta/models`: `{ models: [{ name: "models/…", displayName,
 * inputTokenLimit, supportedGenerationMethods, thinking }] }`. Only models that
 * can generate content are kept — embedding models cannot run a card.
 */
export function parseGoogleModels(raw: unknown): DiscoveredModel[] {
  const models = (
    raw as {
      models?: {
        name?: unknown;
        displayName?: string;
        inputTokenLimit?: number;
        supportedGenerationMethods?: string[];
        thinking?: boolean;
      }[];
    }
  )?.models;
  if (!Array.isArray(models)) return [];
  return models
    .filter(
      (m) =>
        typeof m.name === 'string' && (m.supportedGenerationMethods ?? []).includes('generateContent'),
    )
    .map((m) => {
      const id = (m.name as string).replace(/^models\//, '');
      return {
        id,
        name: label(m.displayName, id),
        contextLength: m.inputTokenLimit ?? null,
        capabilities: m.thinking ? ['thinking'] : [],
      };
    });
}

/**
 * DeepInfra `GET /v1/openai/models`. The list mixes chat, image, video, speech
 * and embedding models; like Hermes, only entries tagged `chat` are kept.
 */
export function parseDeepInfraModels(raw: unknown): DiscoveredModel[] {
  const data = (
    raw as { data?: { id?: unknown; metadata?: { tags?: unknown; context_length?: number } | null }[] }
  )?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((m) => {
      const tags = m.metadata?.tags;
      return typeof m.id === 'string' && Array.isArray(tags) && tags.includes('chat');
    })
    .map((m) => {
      const tags = (m.metadata?.tags as string[]) ?? [];
      return {
        id: m.id as string,
        name: m.id as string,
        contextLength: m.metadata?.context_length ?? null,
        capabilities: tags.filter((t) => t === 'reasoning' || t === 'vision'),
      };
    });
}

/** Command Code `GET /provider/v1/models` (public): `{ data: [{ id, name, context_length }] }`. */
export function parseCommandCodeModels(raw: unknown): DiscoveredModel[] {
  const data = (raw as { data?: { id?: unknown; name?: string; context_length?: number }[] })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((m): m is { id: string; name?: string; context_length?: number } => typeof m.id === 'string')
    .map((m) => ({
      id: m.id,
      name: label(m.name, m.id),
      contextLength: m.context_length ?? null,
      capabilities: [],
    }));
}

/**
 * `codex debug models` — Codex's own catalogue, including each model's
 * supported reasoning levels and default. Models Codex hides from its own
 * picker (internal ones) are left out here too.
 */
export function parseCodexCatalog(raw: unknown): DiscoveredModel[] {
  const models = (
    raw as {
      models?: {
        slug?: unknown;
        display_name?: string;
        visibility?: string;
        context_window?: number;
        default_reasoning_level?: string;
        supported_reasoning_levels?: ({ effort?: string } | string)[];
      }[];
    }
  )?.models;
  if (!Array.isArray(models)) return [];
  return models
    .filter((m) => typeof m.slug === 'string' && m.visibility !== 'hide')
    .map((m) => {
      const efforts = (m.supported_reasoning_levels ?? [])
        .map((l) => (typeof l === 'string' ? l : l?.effort))
        .filter((e): e is string => typeof e === 'string');
      return {
        id: m.slug as string,
        name: label(m.display_name, m.slug as string),
        contextLength: m.context_window ?? null,
        capabilities: [],
        efforts,
        defaultEffort: m.default_reasoning_level ?? null,
      };
    });
}

/** Families on OpenAI's list that cannot hold a text conversation. */
const OPENAI_NON_CHAT = /(embedding|whisper|tts|dall-e|moderation|transcribe|gpt-image|realtime|babbage|davinci)/i;

export function filterOpenAiChatModels(models: DiscoveredModel[]): DiscoveredModel[] {
  return models.filter((m) => !OPENAI_NON_CHAT.test(m.id));
}

// ---------------------------------------------------------------------------
// Providers reached through Hermes with an API key
// ---------------------------------------------------------------------------

export interface HermesApiProvider {
  /** Hermes's own provider id. */
  id: string;
  label: string;
  credential: SecretKey;
  url: string;
  auth: 'bearer' | 'anthropic' | 'google' | 'none';
  /** True when the list answers without a key (a key is still sent if saved). */
  publicList: boolean;
  parse: (raw: unknown) => DiscoveredModel[];
}

export const HERMES_API_PROVIDERS: HermesApiProvider[] = [
  {
    id: 'openai-api',
    label: 'OpenAI API',
    credential: 'OPENAI_API_KEY',
    url: 'https://api.openai.com/v1/models',
    auth: 'bearer',
    publicList: false,
    parse: (raw) => filterOpenAiChatModels(parseOpenAiModels(raw)),
  },
  {
    id: 'anthropic',
    label: 'Anthropic API',
    credential: 'ANTHROPIC_API_KEY',
    url: 'https://api.anthropic.com/v1/models?limit=1000',
    auth: 'anthropic',
    publicList: false,
    parse: parseAnthropicModels,
  },
  {
    id: 'gemini',
    label: 'Google AI (Gemini)',
    credential: 'GOOGLE_API_KEY',
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    auth: 'google',
    publicList: false,
    parse: parseGoogleModels,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    credential: 'DEEPSEEK_API_KEY',
    url: 'https://api.deepseek.com/v1/models',
    auth: 'bearer',
    publicList: false,
    parse: parseOpenAiModels,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    credential: 'XAI_API_KEY',
    url: 'https://api.x.ai/v1/models',
    auth: 'bearer',
    publicList: false,
    parse: parseOpenAiModels,
  },
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    credential: 'DEEPINFRA_API_KEY',
    url: 'https://api.deepinfra.com/v1/openai/models',
    auth: 'bearer',
    publicList: true,
    parse: parseDeepInfraModels,
  },
  {
    id: 'commandcode',
    label: 'Command Code',
    credential: 'COMMANDCODE_API_KEY',
    url: 'https://api.commandcode.ai/provider/v1/models',
    auth: 'none',
    publicList: true,
    parse: parseCommandCodeModels,
  },
  {
    id: 'xiaomi',
    label: 'Xiaomi MiMo',
    credential: 'XIAOMI_API_KEY',
    url: 'https://api.xiaomimimo.com/v1/models',
    auth: 'bearer',
    publicList: false,
    parse: parseOpenAiModels,
  },
  {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    credential: 'OLLAMA_API_KEY',
    url: 'https://ollama.com/v1/models',
    auth: 'bearer',
    publicList: true,
    parse: parseOpenAiModels,
  },
];

/** Build the request headers a provider's list expects for a given key. */
export function listHeaders(auth: HermesApiProvider['auth'], key: string | null): Record<string, string> {
  if (auth === 'anthropic') {
    return key ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { 'anthropic-version': '2023-06-01' };
  }
  if (!key || auth === 'none') return {};
  if (auth === 'google') return { 'x-goog-api-key': key };
  return { Authorization: `Bearer ${key}` };
}

async function fetchProviderList(p: HermesApiProvider, getSecret: SecretGetter): Promise<ListResult> {
  const key = await getSecret(p.credential);
  if (!key && !p.publicList) {
    return { ok: false, error: `No ${p.label} key saved. Add one in Credentials to list its models.` };
  }
  const res = await getJson(p.url, listHeaders(p.auth, key));
  if (!res.ok) return res;
  const models = p.parse(res.json);
  return models.length > 0
    ? { ok: true, models: models.sort((a, b) => a.id.localeCompare(b.id)) }
    : { ok: false, error: 'The model list came back empty.' };
}

async function fetchCodexCatalog(binary: string): Promise<ListResult> {
  const res = await run(binary, ['debug', 'models'], { timeoutMs: 60_000 });
  if (!res.ok) return { ok: false, error: `\`codex debug models\` failed (exit ${res.code ?? 'n/a'}).` };
  try {
    const models = parseCodexCatalog(JSON.parse(res.stdout) as unknown);
    return models.length > 0 ? { ok: true, models } : { ok: false, error: 'Codex listed no models.' };
  } catch {
    return { ok: false, error: 'Could not read the Codex model catalogue.' };
  }
}

function union(values: string[][]): string[] {
  const order = AGENT_EFFORTS.codex;
  const all = new Set(values.flat());
  // Keep Codex's own ordering (low → ultra) instead of first-seen order.
  return [...order.filter((e) => all.has(e)), ...[...all].filter((e) => !order.includes(e))];
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface CatalogInput {
  endpoints: EndpointSettings;
  getSecret: SecretGetter;
  agents: DiscoveredAgent[];
  hermesConfigPath: string | null;
}

export async function buildProviders(
  input: CatalogInput,
): Promise<{ providers: DiscoveredProvider[]; warnings: string[] }> {
  const warnings: string[] = [];
  const claude = input.agents.find((a) => a.id === 'claude-code');
  const codex = input.agents.find((a) => a.id === 'codex');
  const hermes = input.agents.find((a) => a.id === 'hermes');

  const lmKey = await input.getSecret('LM_STUDIO_API_KEY');
  const [liveLists, codexCatalog, codexConfigModels, ollama, lmstudio, hermesYaml] = await Promise.all([
    Promise.all(HERMES_API_PROVIDERS.map((p) => fetchProviderList(p, input.getSecret))),
    codex?.binaryPath
      ? fetchCodexCatalog(codex.binaryPath)
      : Promise.resolve<ListResult>({ ok: false, error: 'Codex is not installed.' }),
    discoverCodexModels(CODEX_CONFIG_PATH),
    discoverOllama(input.endpoints.ollamaBaseUrl),
    discoverLmStudio(input.endpoints.lmStudioBaseUrl, lmKey),
    input.hermesConfigPath
      ? fs.readFile(input.hermesConfigPath, 'utf8').catch(() => null)
      : Promise.resolve(null),
  ]);
  const live = new Map(HERMES_API_PROVIDERS.map((p, i) => [p.id, liveLists[i]] as const));

  const providers: DiscoveredProvider[] = [];

  // --- Claude Code: aliases always, plus the live Anthropic list when a key is saved.
  const anthropicLive = live.get('anthropic');
  providers.push({
    id: 'anthropic',
    name: 'Anthropic (Claude Code)',
    agentIds: ['claude-code'],
    availability: claude?.availability ?? 'unavailable',
    statusDetail: 'Runs on your Claude sign-in. Aliases always point at the newest release.',
    models: dedupe([...claudeModels(), ...(anthropicLive?.ok ? anthropicLive.models : [])]),
    live: Boolean(anthropicLive?.ok),
    efforts: AGENT_EFFORTS['claude-code'],
    effortLabel: 'Effort',
    effortNote: null,
    modelsError: anthropicLive && !anthropicLive.ok ? `Only the aliases are listed: ${anthropicLive.error}` : null,
  });

  // --- Codex: its own catalogue, with each model's reasoning levels.
  const codexModels = codexCatalog.ok ? codexCatalog.models : codexConfigModels;
  providers.push({
    id: 'openai',
    name: 'OpenAI (Codex · ChatGPT sign-in)',
    agentIds: ['codex'],
    availability: codex?.availability ?? 'unavailable',
    statusDetail: 'Runs on your ChatGPT sign-in. Models and effort levels come from `codex debug models`.',
    models: codexModels,
    live: codexCatalog.ok,
    efforts: codexCatalog.ok ? union(codexModels.map((m) => m.efforts ?? [])) : AGENT_EFFORTS.codex,
    effortLabel: 'Reasoning effort',
    effortNote: 'Each model narrows this list to the levels it supports.',
    modelsError: codexCatalog.ok ? null : codexCatalog.error,
  });

  providers.push(ollama, lmstudio);

  // --- Hermes: every provider in its config, plus every provider with a key field here.
  if (hermes) {
    let configured: DiscoveredProvider[] = [];
    if (hermesYaml) {
      configured = hermesProviders(parseHermesConfig(hermesYaml));
    } else if (hermes.availability === 'available') {
      warnings.push('Hermes is installed but its config.yaml was not found.');
    }
    const byId = new Map(configured.map((p) => [p.id, p] as const));

    for (const api of HERMES_API_PROVIDERS) {
      const id = `hermes:${api.id}`;
      const result = live.get(api.id);
      const existing = byId.get(id);
      const liveModels = result?.ok ? result.models : [];
      byId.set(id, {
        id,
        name: `${api.label} (via Hermes)`,
        agentIds: ['hermes'],
        availability: result?.ok || existing ? 'available' : 'degraded',
        statusDetail: result?.ok
          ? `${liveModels.length} models listed live.`
          : (result?.error ?? 'Not checked.'),
        models: dedupe([...liveModels, ...(existing?.models ?? [])]),
        live: Boolean(result?.ok),
        efforts: AGENT_EFFORTS.hermes,
        effortLabel: 'Reasoning effort',
        effortNote: 'Hermes passes this on where the provider supports reasoning; some models ignore it.',
        modelsError: result && !result.ok ? result.error : null,
      });
    }

    providers.push(...[...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }

  return { providers, warnings };
}
