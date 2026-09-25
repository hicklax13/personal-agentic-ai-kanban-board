import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BoardState } from '@shared/types';
import { createDefaultBoard, migrate } from './schema.js';

/**
 * Durable JSON persistence for the board.
 *
 * Writes go through a temp file + rename. On every OS `rename` over an existing
 * path is atomic, so a crash (or a pulled power cord) mid-save can leave you
 * with the old board or the new board, but never a half-written file. That
 * property is the whole reason this app can get away without a database.
 */
export class JsonStore<T> {
  constructor(
    private readonly filePath: string,
    private readonly fallback: () => T,
    private readonly hydrate: (raw: unknown) => T,
  ) {}

  get path(): string {
    return this.filePath;
  }

  async read(): Promise<T> {
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      return this.hydrate(JSON.parse(text) as unknown);
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

  async write(value: T): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
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

export function createBoardStore(filePath: string, workspaceRoot: string | null): JsonStore<BoardState> {
  return new JsonStore<BoardState>(
    filePath,
    () => createDefaultBoard(workspaceRoot),
    (raw) => migrate(raw, workspaceRoot),
  );
}
