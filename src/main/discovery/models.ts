import { promises as fs } from 'node:fs';
import type { DiscoveredModel, DiscoveredProvider } from '@shared/types';
import { AGENT_EFFORTS } from '@shared/runSettings';

/**
 * Model discovery, in order of trust:
 *
 *   1. Live HTTP query  (Ollama, LM Studio) — authoritative.
 *   2. The user's own config files (Codex config.toml, Hermes config.yaml) —
 *      real values this machine is configured with.
 *   3. A documented alias list (Claude Code) — the CLI accepts aliases and full
 *      model ids but has no "list models" command, so this is the honest ceiling.
 *
 * Every provider records which tier it came from via `live`, and the card editor
 * always pairs the dropdown with a free-text field. That way an incomplete
 * catalogue can never stop someone running a model the CLI would have accepted.
 */

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs = 5000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Ollama — live
// ---------------------------------------------------------------------------

interface OllamaTag {
  name?: string;
  details?: { context_length?: number };
  capabilities?: string[];
}

export function parseOllamaTags(raw: unknown): DiscoveredModel[] {
  const models = (raw as { models?: OllamaTag[] })?.models;
  if (!Array.isArray(models)) return [];
  return models
    .filter((m) => typeof m.name === 'string')
    .map((m) => ({
      id: m.name as string,
      name: m.name as string,
      contextLength: m.details?.context_length ?? null,
      capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
      // Ollama's /api/chat `think` switch only does anything on models that
      // report the "thinking" capability, so only those get the choice.
      efforts:
        Array.isArray(m.capabilities) && m.capabilities.includes('thinking') ? AGENT_EFFORTS.ollama : [],
    }));
}

export async function discoverOllama(baseUrl: string): Promise<DiscoveredProvider> {
  const base = baseUrl.replace(/\/+$/, '');
  try {
    const raw = await fetchJson(`${base}/api/tags`, {});
    const models = parseOllamaTags(raw);
    return {
      id: 'ollama',
      name: 'Ollama (local)',
      agentIds: ['ollama', 'hermes', 'codex'],
      availability: models.length > 0 ? 'available' : 'degraded',
      statusDetail:
        models.length > 0
          ? `${models.length} model(s) available at ${base}`
          : `Reachable at ${base} but no models are pulled. Run: ollama pull <model>`,
      models,
      live: true,
      efforts: models.some((m) => (m.efforts ?? []).length > 0) ? AGENT_EFFORTS.ollama : [],
      effortLabel: 'Thinking',
      effortNote: 'Only models that support thinking use this.',
    };
  } catch (err) {
    return {
      id: 'ollama',
      name: 'Ollama (local)',
      agentIds: ['ollama', 'hermes', 'codex'],
      availability: 'unavailable',
      statusDetail: `Not reachable at ${base}: ${err instanceof Error ? err.message : String(err)}`,
      models: [],
      live: true,
      efforts: [],
      effortLabel: 'Thinking',
      effortNote: null,
    };
  }
}

// ---------------------------------------------------------------------------
// LM Studio — live, but token-gated
// ---------------------------------------------------------------------------

export function parseOpenAiModels(raw: unknown): DiscoveredModel[] {
  const data = (raw as { data?: { id?: string }[] })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((m) => typeof m.id === 'string')
    .map((m) => ({ id: m.id as string, name: m.id as string, contextLength: null, capabilities: [] }));
}

export async function discoverLmStudio(
  baseUrl: string,
  apiKey: string | null,
): Promise<DiscoveredProvider> {
  const base = baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const raw = await fetchJson(`${base}/v1/models`, headers);
    const models = parseOpenAiModels(raw);
    return {
      id: 'lmstudio',
      name: 'LM Studio (local)',
      agentIds: ['lmstudio', 'codex'],
      availability: 'available',
      statusDetail: `${models.length} model(s) available at ${base}`,
      models,
      live: true,
      efforts: AGENT_EFFORTS.lmstudio,
      effortLabel: 'Effort',
      effortNote: 'LM Studio has no effort setting this app can pass.',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A 401 means the server is up and only a token is missing — that is a
    // materially different situation from "not installed", so say so.
    const tokenIssue = message.includes('401') || message.includes('403');
    return {
      id: 'lmstudio',
      name: 'LM Studio (local)',
      agentIds: ['lmstudio', 'codex'],
      availability: tokenIssue ? 'degraded' : 'unavailable',
      statusDetail: tokenIssue
        ? `Server is running at ${base} but rejected the request (${message}). Add LM_STUDIO_API_KEY in Settings.`
        : `Not reachable at ${base}: ${message}`,
      models: [],
      live: true,
      efforts: AGENT_EFFORTS.lmstudio,
      effortLabel: 'Effort',
      effortNote: 'LM Studio has no effort setting this app can pass.',
    };
  }
}

// ---------------------------------------------------------------------------
// Claude Code — documented aliases
// ---------------------------------------------------------------------------

/**
 * `claude --model` accepts an alias or a full model id (per `claude --help`).
 * Aliases are listed first because they always resolve to the current model and
 * therefore never go stale.
 */
export function claudeModels(): DiscoveredModel[] {
  const alias = (id: string, name: string): DiscoveredModel => ({
    id,
    name,
    contextLength: null,
    capabilities: ['alias'],
  });
  return [
    alias('opus', 'opus (alias for latest Opus)'),
    alias('sonnet', 'sonnet (alias for latest Sonnet)'),
    alias('haiku', 'haiku (alias for latest Haiku)'),
    alias('fable', 'fable (alias for latest Fable)'),
  ];
}

// ---------------------------------------------------------------------------
// Codex — read the user's own config.toml
// ---------------------------------------------------------------------------

/** Pull the top-level `model = "..."` assignment out of a TOML file. */
export function parseCodexModel(toml: string): string | null {
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Stop at the first table header: after `[section]`, `model` means
    // something else entirely.
    if (trimmed.startsWith('[')) break;
    const m = trimmed.match(/^model\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  }
  return null;
}

export async function discoverCodexModels(configPath: string): Promise<DiscoveredModel[]> {
  try {
    const text = await fs.readFile(configPath, 'utf8');
    const model = parseCodexModel(text);
    return model
      ? [{ id: model, name: `${model} (from config.toml)`, contextLength: null, capabilities: [] }]
      : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Hermes — read the user's own config.yaml
// ---------------------------------------------------------------------------

export interface HermesConfigSummary {
  defaultModel: string | null;
  defaultProvider: string | null;
  /** provider id -> model ids configured for it. */
  providers: Record<string, string[]>;
  /** Fallback chain, as provider/model pairs. */
  fallbacks: { provider: string; model: string }[];
}

/**
 * Read just the handful of keys we need out of Hermes's config.yaml.
 *
 * A YAML dependency would be overkill: Hermes writes a predictable two-space
 * indented file and we only care about four paths. Anything this misses simply
 * does not appear in the dropdown, and the free-text model field still works.
 */
export function parseHermesConfig(yaml: string): HermesConfigSummary {
  const out: HermesConfigSummary = {
    defaultModel: null,
    defaultProvider: null,
    providers: {},
    fallbacks: [],
  };

  const lines = yaml.split(/\r?\n/);
  let section: 'none' | 'model' | 'providers' | 'fallbacks' = 'none';
  let currentProvider: string | null = null;
  let inProviderModels = false;
  let pendingFallback: { provider?: string; model?: string } | null = null;

  const indentOf = (l: string): number => l.length - l.trimStart().length;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = indentOf(line);
    const trimmed = line.trim();

    if (indent === 0) {
      // Flush any fallback entry still being assembled.
      if (pendingFallback?.provider && pendingFallback.model) {
        out.fallbacks.push({ provider: pendingFallback.provider, model: pendingFallback.model });
      }
      pendingFallback = null;
      currentProvider = null;
      inProviderModels = false;

      if (trimmed.startsWith('model:')) section = 'model';
      else if (trimmed.startsWith('providers:')) section = 'providers';
      else if (trimmed.startsWith('fallback_providers:')) section = 'fallbacks';
      else section = 'none';
      continue;
    }

    if (section === 'model') {
      const def = trimmed.match(/^default:\s*(.+)$/);
      if (def) out.defaultModel = unquote(def[1]);
      const prov = trimmed.match(/^provider:\s*(.+)$/);
      if (prov) out.defaultProvider = unquote(prov[1]);
      continue;
    }

    if (section === 'providers') {
      if (indent === 2) {
        const p = trimmed.match(/^([A-Za-z0-9._-]+):\s*$/);
        if (p) {
          currentProvider = p[1];
          out.providers[currentProvider] ??= [];
          inProviderModels = false;
        }
        continue;
      }
      if (!currentProvider) continue;
      if (indent === 4) {
        if (/^models:\s*$/.test(trimmed)) {
          inProviderModels = true;
          continue;
        }
        const single = trimmed.match(/^model:\s*(.+)$/);
        if (single) {
          const id = unquote(single[1]);
          if (id && !out.providers[currentProvider].includes(id)) {
            out.providers[currentProvider].push(id);
          }
        }
        inProviderModels = false;
        continue;
      }
      if (indent >= 6 && inProviderModels) {
        // `    qwen3:14b: {}` — the model id is everything before the last colon.
        const entry = trimmed.match(/^(.+?):\s*(\{\}|)$/);
        if (entry) {
          const id = unquote(entry[1]);
          if (id && !out.providers[currentProvider].includes(id)) {
            out.providers[currentProvider].push(id);
          }
        }
      }
      continue;
    }

    if (section === 'fallbacks') {
      if (trimmed.startsWith('- ')) {
        if (pendingFallback?.provider && pendingFallback.model) {
          out.fallbacks.push({ provider: pendingFallback.provider, model: pendingFallback.model });
        }
        pendingFallback = {};
        const first = trimmed.slice(2).trim();
        applyFallbackField(pendingFallback, first);
        continue;
      }
      if (pendingFallback) applyFallbackField(pendingFallback, trimmed);
    }
  }

  if (pendingFallback?.provider && pendingFallback.model) {
    out.fallbacks.push({ provider: pendingFallback.provider, model: pendingFallback.model });
  }
  return out;
}

function applyFallbackField(target: { provider?: string; model?: string }, text: string): void {
  const p = text.match(/^provider:\s*(.+)$/);
  if (p) target.provider = unquote(p[1]);
  const m = text.match(/^model:\s*(.+)$/);
  if (m) target.model = unquote(m[1]);
}

function unquote(v: string): string {
  return v.trim().replace(/^["']/, '').replace(/["']$/, '').trim();
}

/** Build provider entries for Hermes out of its parsed config. */
export function hermesProviders(summary: HermesConfigSummary): DiscoveredProvider[] {
  const byProvider = new Map<string, Set<string>>();

  const add = (provider: string, model: string): void => {
    if (!provider || !model) return;
    if (!byProvider.has(provider)) byProvider.set(provider, new Set());
    byProvider.get(provider)?.add(model);
  };

  if (summary.defaultProvider && summary.defaultModel) {
    add(summary.defaultProvider, summary.defaultModel);
  }
  for (const [provider, models] of Object.entries(summary.providers)) {
    for (const m of models) add(provider, m);
  }
  for (const f of summary.fallbacks) add(f.provider, f.model);

  return [...byProvider.entries()]
    .map(([id, models]) => ({
      id: `hermes:${id}`,
      name: `${id} (via Hermes)`,
      agentIds: ['hermes'],
      availability: 'available' as const,
      statusDetail: `Configured in the Hermes config.yaml on this machine`,
      models: [...models].map((m) => ({
        id: m,
        name: m,
        contextLength: null,
        capabilities: [],
      })),
      live: false,
      efforts: AGENT_EFFORTS.hermes,
      effortLabel: 'Reasoning effort',
      effortNote: null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
