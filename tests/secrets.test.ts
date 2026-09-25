import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SecretStore, passthroughCipher, type Cipher } from '../src/main/secrets/secretStore.js';
import { DEFAULT_ENDPOINTS, normaliseEndpoints, SettingsStore } from '../src/main/settings.js';

let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `agent-kanban-sec-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/**
 * A stand-in for Electron's safeStorage. Reversing the bytes is enough to prove
 * the store round-trips through the cipher rather than writing plaintext.
 */
const reversingCipher: Cipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse()),
  decrypt: (blob) => Buffer.from([...blob].reverse()).toString('utf8'),
};

describe('SecretStore', () => {
  it('round-trips a secret through the cipher', async () => {
    const store = new SecretStore(join(dir, 's.json'), reversingCipher);
    await store.set('ANTHROPIC_API_KEY', 'test-anthropic-value');
    expect(await store.get('ANTHROPIC_API_KEY')).toBe('test-anthropic-value');
  });

  it('never writes the plaintext value to disk', async () => {
    const path = join(dir, 's.json');
    const store = new SecretStore(path, reversingCipher);
    await store.set('OPENAI_API_KEY', 'test-openai-PLAINTEXT-MARKER');

    const onDisk = await fs.readFile(path, 'utf8');
    expect(onDisk).not.toContain('test-openai-PLAINTEXT-MARKER');
    // The base64 of the plaintext must not appear either.
    expect(onDisk).not.toContain(Buffer.from('test-openai-PLAINTEXT-MARKER').toString('base64'));
  });

  it('reports presence without exposing values', async () => {
    const store = new SecretStore(join(dir, 's.json'), reversingCipher);
    await store.set('LM_STUDIO_API_KEY', 'token');
    const presence = await store.presence();
    expect(presence.LM_STUDIO_API_KEY).toBe(true);
    expect(Object.values(presence).every((v) => v === true)).toBe(true);
    expect(JSON.stringify(presence)).not.toContain('token');
  });

  it('clears a secret', async () => {
    const store = new SecretStore(join(dir, 's.json'), reversingCipher);
    await store.set('OPENAI_API_KEY', 'v');
    await store.clear('OPENAI_API_KEY');
    expect(await store.get('OPENAI_API_KEY')).toBeNull();
    expect((await store.presence()).OPENAI_API_KEY).toBeUndefined();
  });

  it('returns null for a key that was never set', async () => {
    const store = new SecretStore(join(dir, 's.json'), reversingCipher);
    expect(await store.get('ANTHROPIC_API_KEY')).toBeNull();
  });

  it('survives a missing file', async () => {
    const store = new SecretStore(join(dir, 'nope', 'deep', 's.json'), reversingCipher);
    expect(await store.presence()).toEqual({});
  });

  it('flags the plaintext fallback when the OS keyring is unavailable', async () => {
    const path = join(dir, 's.json');
    const store = new SecretStore(path, passthroughCipher);
    await store.set('LM_STUDIO_API_KEY', 'weak');

    expect(await store.usedPlaintextFallback()).toBe(true);
    // It still works — it just tells the truth about not being encrypted.
    expect(await store.get('LM_STUDIO_API_KEY')).toBe('weak');
  });

  it('keeps the plaintext flag sticky once set', async () => {
    const path = join(dir, 's.json');
    await new SecretStore(path, passthroughCipher).set('LM_STUDIO_API_KEY', 'weak');

    const upgraded = new SecretStore(path, reversingCipher);
    await upgraded.set('ANTHROPIC_API_KEY', 'strong');
    // The file as a whole is still not trustworthy, so the warning must persist.
    expect(await upgraded.usedPlaintextFallback()).toBe(true);
  });

  it('reports a key it cannot decrypt as absent instead of throwing', async () => {
    const path = join(dir, 's.json');
    await new SecretStore(path, reversingCipher).set('OPENAI_API_KEY', 'v');

    const otherAccount = new SecretStore(path, {
      isAvailable: () => true,
      encrypt: () => Buffer.from(''),
      decrypt: () => {
        throw new Error('wrong DPAPI key');
      },
    });
    expect(await otherAccount.get('OPENAI_API_KEY')).toBeNull();
  });
});

describe('normaliseEndpoints', () => {
  it('fills in defaults for missing values', () => {
    expect(normaliseEndpoints(undefined)).toEqual(DEFAULT_ENDPOINTS);
    expect(normaliseEndpoints({})).toEqual(DEFAULT_ENDPOINTS);
  });

  it('trims a trailing slash so URL joins do not double up', () => {
    expect(normaliseEndpoints({ ollamaBaseUrl: 'http://localhost:11434/' }).ollamaBaseUrl).toBe(
      'http://localhost:11434',
    );
  });

  it('rejects a malformed URL rather than failing later at fetch time', () => {
    expect(normaliseEndpoints({ ollamaBaseUrl: 'not a url' }).ollamaBaseUrl).toBe(
      DEFAULT_ENDPOINTS.ollamaBaseUrl,
    );
  });

  it('rejects a non-http scheme', () => {
    expect(normaliseEndpoints({ lmStudioBaseUrl: 'file:///etc/passwd' }).lmStudioBaseUrl).toBe(
      DEFAULT_ENDPOINTS.lmStudioBaseUrl,
    );
  });

  it('accepts a valid custom endpoint', () => {
    expect(normaliseEndpoints({ ollamaBaseUrl: 'http://192.168.1.9:11434' }).ollamaBaseUrl).toBe(
      'http://192.168.1.9:11434',
    );
  });
});

describe('SettingsStore', () => {
  it('round-trips endpoints across a restart', async () => {
    const path = join(dir, 'settings.json');
    await new SettingsStore(path).write({
      ollamaBaseUrl: 'http://127.0.0.1:9999',
      lmStudioBaseUrl: 'http://127.0.0.1:8888',
    });
    const reloaded = await new SettingsStore(path).read();
    expect(reloaded.ollamaBaseUrl).toBe('http://127.0.0.1:9999');
    expect(reloaded.lmStudioBaseUrl).toBe('http://127.0.0.1:8888');
  });

  it('falls back to defaults when the file is missing', async () => {
    expect(await new SettingsStore(join(dir, 'absent.json')).read()).toEqual(DEFAULT_ENDPOINTS);
  });
});
