import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { SecretKey } from '@shared/types';

/**
 * The encryption primitive, abstracted away from Electron.
 *
 * In the real app this is backed by Electron's `safeStorage`, which on Windows
 * calls DPAPI — the key is derived from the logged-in Windows account, so the
 * ciphertext is worthless if the file is copied to another machine or read by
 * another user. Injecting the interface means the test suite can drive the same
 * read/write logic with a stub instead of booting a full Electron process.
 */
export interface Cipher {
  /** False when the OS refused to provide a keyring (rare, but must be surfaced). */
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(blob: Buffer): string;
}

interface SecretFile {
  version: number;
  /** base64 of the encrypted bytes, keyed by SecretKey. */
  entries: Record<string, string>;
  /** True when entries were written without OS encryption available. */
  plaintextFallback: boolean;
}

const EMPTY: SecretFile = { version: 1, entries: {}, plaintextFallback: false };

/**
 * Stores API keys on disk encrypted at rest.
 *
 * Secret *values* never cross the IPC boundary: the renderer can ask which keys
 * are set and can set or clear them, but it can never read one back. That keeps
 * a compromised renderer (the only part of Electron that runs web content) from
 * being able to exfiltrate credentials.
 */
export class SecretStore {
  private cache: SecretFile | null = null;

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
  ) {}

  get path(): string {
    return this.filePath;
  }

  get encryptionAvailable(): boolean {
    return this.cipher.isAvailable();
  }

  private async load(): Promise<SecretFile> {
    if (this.cache) return this.cache;
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(text) as Partial<SecretFile>;
      this.cache = {
        version: parsed.version ?? 1,
        entries: parsed.entries ?? {},
        plaintextFallback: parsed.plaintextFallback ?? false,
      };
    } catch {
      // Missing or unreadable file simply means "no secrets yet".
      this.cache = { ...EMPTY, entries: {} };
    }
    return this.cache;
  }

  private async persist(file: SecretFile): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
    // Best-effort owner-only permissions. A no-op on Windows, where DPAPI plus
    // the user profile ACL already does the real work.
    try {
      await fs.chmod(this.filePath, 0o600);
    } catch {
      /* ignore */
    }
    this.cache = file;
  }

  async set(key: SecretKey, value: string): Promise<void> {
    const file = await this.load();
    const available = this.cipher.isAvailable();
    const encoded = available
      ? this.cipher.encrypt(value).toString('base64')
      : Buffer.from(value, 'utf8').toString('base64');
    await this.persist({
      ...file,
      entries: { ...file.entries, [key]: encoded },
      // Sticky flag: once anything was written without OS encryption the UI
      // must keep warning, because the file as a whole is no longer trustworthy.
      plaintextFallback: file.plaintextFallback || !available,
    });
  }

  async get(key: SecretKey): Promise<string | null> {
    const file = await this.load();
    const encoded = file.entries[key];
    if (!encoded) return null;
    const raw = Buffer.from(encoded, 'base64');
    if (file.plaintextFallback && !this.cipher.isAvailable()) {
      return raw.toString('utf8');
    }
    try {
      return this.cipher.decrypt(raw);
    } catch {
      // A key encrypted by a different Windows account cannot be recovered;
      // report it as absent rather than crashing the settings panel.
      return null;
    }
  }

  async clear(key: SecretKey): Promise<void> {
    const file = await this.load();
    const entries = { ...file.entries };
    delete entries[key];
    await this.persist({ ...file, entries });
  }

  /** Which keys hold a value. Safe to send to the renderer. */
  async presence(): Promise<Record<string, boolean>> {
    const file = await this.load();
    const out: Record<string, boolean> = {};
    for (const key of Object.keys(file.entries)) out[key] = true;
    return out;
  }

  async usedPlaintextFallback(): Promise<boolean> {
    const file = await this.load();
    return file.plaintextFallback;
  }
}

/**
 * A cipher that performs no encryption.
 *
 * Only used when the OS keyring is unavailable, and it deliberately reports
 * `isAvailable() === false` so the UI shows a warning instead of implying the
 * file is protected when it is not.
 */
export const passthroughCipher: Cipher = {
  isAvailable: () => false,
  encrypt: (plain) => Buffer.from(plain, 'utf8'),
  decrypt: (blob) => blob.toString('utf8'),
};
