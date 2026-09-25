import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { BoardState } from '@shared/types';
import { BOARD_SCHEMA_VERSION, createDefaultBoard, migrate } from './schema.js';

/**
 * Durable JSON persistence for the board.
 *
 * Writes go through a temp file + rename. On every OS `rename` over an existing
 * path is atomic, so a crash (or a pulled power cord) mid-save can leave you
 * with the old board or the new board, but never a half-written file. That
 * property is the whole reason this app can get away without a database.
 *
 * Writes are also queued: several parts of the app save the board (the window,
 * run updates, the workflow engine), and two overlapping writes through one
 * temp file would fight over it.
 */
export class JsonStore<T> {
  private queue: Promise<void> = Promise.resolve();
  private writes = 0;

  constructor(
    private readonly filePath: string,
    private readonly fallback: () => T,
    private readonly hydrate: (raw: unknown) => T,
    /**
     * Called with the parsed file before it is upgraded. Returning a label
     * (e.g. "v1") keeps a one-time copy of the original next to it.
     */
    private readonly backupLabel?: (raw: unknown) => string | null,
  ) {}

  get path(): string {
    return this.filePath;
  }

  async read(): Promise<T> {
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      const raw = JSON.parse(text) as unknown;
      const label = this.backupLabel?.(raw);
      if (label) await this.keepBackup(text, label);
      return this.hydrate(raw);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        // First launch: materialise the default so the file exists from now on.
        const initial = this.fallback();
        await this.write(initial);
        return initial;
      }
      // A corrupt file should not brick the app. Preserve the bad copy for
      // forensics, then start clean — losing the board silently would be worse.
      if (err instanceof SyntaxError) {
        await this.quarantine();
        const initial = this.fallback();
        await this.write(initial);
        return initial;
      }
      throw err;
    }
  }

  write(value: T): Promise<void> {
    // Serialise now, so a later change to `value` cannot leak into this write.
    const body = JSON.stringify(value, null, 2);
    const next = this.queue.then(() => this.writeNow(body));
    // A failed write must not wedge every write after it.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async writeNow(body: string): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${++this.writes}.tmp`;
    await fs.writeFile(tmp, body, 'utf8');
    await fs.rename(tmp, this.filePath);
  }

  /** Copy the original file once, before an upgrade rewrites it. */
  private async keepBackup(text: string, label: string): Promise<void> {
    const ext = extname(this.filePath);
    const target = join(dirname(this.filePath), `${basename(this.filePath, ext)}.${label}-backup${ext}`);
    try {
      await fs.writeFile(target, text, { encoding: 'utf8', flag: 'wx' });
    } catch {
      // Already kept on an earlier launch (or not writable): nothing more to do.
    }
  }

  private async quarantine(): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(dirname(this.filePath), `corrupt-${stamp}.json`);
    try {
      await fs.rename(this.filePath, target);
    } catch {
      // Best effort only — if we cannot move it we still want to carry on.
    }
  }
}

function fileVersion(raw: unknown): number {
  const v = (raw as { version?: unknown } | null)?.version;
  return typeof v === 'number' ? v : 1;
}

export function createBoardStore(filePath: string, workspaceRoot: string | null): JsonStore<BoardState> {
  return new JsonStore<BoardState>(
    filePath,
    () => createDefaultBoard(workspaceRoot),
    (raw) => migrate(raw, workspaceRoot),
    (raw) =>
      raw && typeof raw === 'object' && fileVersion(raw) < BOARD_SCHEMA_VERSION
        ? `v${fileVersion(raw)}`
        : null,
  );
}
