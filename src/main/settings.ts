import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { EndpointSettings } from '@shared/types';

/**
 * Endpoints are stored separately from secrets: they are not sensitive, the
 * user may well want to read or hand-edit them, and keeping them out of the
 * encrypted blob means a lost encryption key does not also lose the config.
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

export class SettingsStore {
  private cache: EndpointSettings | null = null;

  constructor(private readonly filePath: string) {}

  async read(): Promise<EndpointSettings> {
    if (this.cache) return this.cache;
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text) as { endpoints?: Partial<EndpointSettings> };
      this.cache = normaliseEndpoints(parsed.endpoints);
    } catch {
      this.cache = { ...DEFAULT_ENDPOINTS };
    }
    return this.cache;
  }

  async write(endpoints: EndpointSettings): Promise<EndpointSettings> {
    const normalised = normaliseEndpoints(endpoints);
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ endpoints: normalised }, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
    this.cache = normalised;
    return normalised;
  }
}
