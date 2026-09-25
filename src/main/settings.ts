import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { EndpointSettings, JudgeSettings, ProviderDefault } from '@shared/types';

/**
 * Non-secret settings: endpoints and each provider's default model and effort.
 *
 * Stored separately from secrets: none of this is sensitive, the user may well
 * want to read or hand-edit it, and keeping it out of the encrypted blob means a
 * lost encryption key does not also lose the config.
 */

export const DEFAULT_ENDPOINTS: EndpointSettings = {
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  lmStudioBaseUrl: 'http://127.0.0.1:1234',
};

export function normaliseEndpoints(input: Partial<EndpointSettings> | undefined): EndpointSettings {
  const clean = (value: unknown, fallback: string): string => {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    const trimmed = value.trim().replace(/\/+$/, '');
    // Reject anything that is not an absolute http(s) URL; a malformed endpoint
    // would otherwise surface as a confusing fetch error much later.
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
      return trimmed;
    } catch {
      return fallback;
    }
  };

  return {
    ollamaBaseUrl: clean(input?.ollamaBaseUrl, DEFAULT_ENDPOINTS.ollamaBaseUrl),
    lmStudioBaseUrl: clean(input?.lmStudioBaseUrl, DEFAULT_ENDPOINTS.lmStudioBaseUrl),
  };
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Keep only well-formed entries; an entry with nothing chosen is dropped. */
export function normaliseProviderDefaults(input: unknown): Record<string, ProviderDefault> {
  const out: Record<string, ProviderDefault> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [id, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!id || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const entry: ProviderDefault = { model: cleanText(r.model), effort: cleanText(r.effort) };
    const provider = cleanText(r.provider);
    if (provider) entry.provider = provider;
    if (entry.model || entry.effort || entry.provider) out[id] = entry;
  }
  return out;
}

/** Hermes's goal loop allows 20 turns; each round here is a whole agent run, so fewer. */
export const DEFAULT_JUDGE_ROUNDS = 5;
export const MAX_JUDGE_ROUNDS = 50;

export const DEFAULT_JUDGE: JudgeSettings = {
  agentId: null,
  providerId: null,
  model: null,
  effort: null,
  allowedTools: [],
  allowedMcpServers: [],
  allowedPlugins: [],
  allowedSkills: [],
  maxRounds: DEFAULT_JUDGE_ROUNDS,
};

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))]
    : [];
}

export function normaliseJudge(input: unknown): JudgeSettings {
  if (!input || typeof input !== 'object') return { ...DEFAULT_JUDGE };
  const r = input as Record<string, unknown>;
  const rounds = typeof r.maxRounds === 'number' && Number.isFinite(r.maxRounds) ? Math.round(r.maxRounds) : DEFAULT_JUDGE_ROUNDS;
  return {
    agentId: cleanText(r.agentId),
    providerId: cleanText(r.providerId),
    model: cleanText(r.model),
    effort: cleanText(r.effort),
    allowedTools: cleanList(r.allowedTools),
    allowedMcpServers: cleanList(r.allowedMcpServers),
    allowedPlugins: cleanList(r.allowedPlugins),
    allowedSkills: cleanList(r.allowedSkills),
    maxRounds: Math.min(MAX_JUDGE_ROUNDS, Math.max(1, rounds)),
  };
}

interface SettingsFile {
  endpoints: EndpointSettings;
  providerDefaults: Record<string, ProviderDefault>;
  judge: JudgeSettings;
}

export class SettingsStore {
  private cache: SettingsFile | null = null;

  constructor(private readonly filePath: string) {}

  private async load(): Promise<SettingsFile> {
    if (this.cache) return this.cache;
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text) as Partial<{
        endpoints: unknown;
        providerDefaults: unknown;
        judge: unknown;
      }>;
      this.cache = {
        endpoints: normaliseEndpoints(parsed.endpoints as Partial<EndpointSettings> | undefined),
        providerDefaults: normaliseProviderDefaults(parsed.providerDefaults),
        judge: normaliseJudge(parsed.judge),
      };
    } catch {
      this.cache = { endpoints: { ...DEFAULT_ENDPOINTS }, providerDefaults: {}, judge: { ...DEFAULT_JUDGE } };
    }
    return this.cache;
  }

  private async persist(file: SettingsFile): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
    this.cache = file;
  }

  async read(): Promise<EndpointSettings> {
    return (await this.load()).endpoints;
  }

  async write(endpoints: EndpointSettings): Promise<EndpointSettings> {
    const file = await this.load();
    const normalised = normaliseEndpoints(endpoints);
    await this.persist({ ...file, endpoints: normalised });
    return normalised;
  }

  async readProviderDefaults(): Promise<Record<string, ProviderDefault>> {
    return (await this.load()).providerDefaults;
  }

  /** Save one provider's default; an empty choice removes the entry. */
  async setProviderDefault(
    providerId: string,
    value: ProviderDefault,
  ): Promise<Record<string, ProviderDefault>> {
    const file = await this.load();
    const merged = normaliseProviderDefaults({ ...file.providerDefaults, [providerId]: value });
    await this.persist({ ...file, providerDefaults: merged });
    return merged;
  }

  async readJudge(): Promise<JudgeSettings> {
    return (await this.load()).judge;
  }

  async setJudge(value: JudgeSettings): Promise<JudgeSettings> {
    const file = await this.load();
    const judge = normaliseJudge(value);
    await this.persist({ ...file, judge });
    return judge;
  }
}
