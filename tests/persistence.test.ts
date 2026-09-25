import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBoardStore, JsonStore } from '../src/main/store/jsonStore.js';
import { BOARD_SCHEMA_VERSION, createDefaultBoard, migrate } from '../src/main/store/schema.js';
import { addCard } from '../shared/boardOps.js';

let dir: string;

beforeEach(async () => {
  dir = join(tmpdir(), `agent-kanban-test-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('JsonStore', () => {
  it('creates the file with a default value on first read', async () => {
    const path = join(dir, 'board.json');
    const store = createBoardStore(path, 'C:/ws');
    const loaded = await store.read();

    expect(loaded.columns).toHaveLength(4);
    // The file must exist on disk after the first read, not just in memory.
    const onDisk = JSON.parse(await fs.readFile(path, 'utf8')) as { columns: unknown[] };
    expect(onDisk.columns).toHaveLength(4);
  });

  it('round-trips a board across a simulated restart', async () => {
    const path = join(dir, 'board.json');

    const first = createBoardStore(path, 'C:/ws');
    let state = await first.read();
    state = addCard(state, state.columns[1].id, {
      title: 'Persisted card',
      config: { taskPrompt: 'do the thing', agentId: 'hermes', model: 'deepseek-flash' },
    });
    await first.write(state);

    // A brand-new store instance is the same thing as relaunching the app.
    const second = createBoardStore(path, 'C:/ws');
    const reloaded = await second.read();

    const card = reloaded.cards.find((c) => c.title === 'Persisted card');
    expect(card).toBeDefined();
    expect(card?.config.taskPrompt).toBe('do the thing');
    expect(card?.config.agentId).toBe('hermes');
    expect(card?.config.model).toBe('deepseek-flash');
    expect(card?.columnId).toBe(reloaded.columns[1].id);
  });

  it('leaves no temp files behind after a write', async () => {
    const path = join(dir, 'board.json');
    const store = createBoardStore(path, null);
    await store.write(createDefaultBoard(null));
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.includes('.tmp'))).toHaveLength(0);
  });

  it('quarantines a corrupt file rather than crashing', async () => {
    const path = join(dir, 'board.json');
    await fs.writeFile(path, '{ this is not json', 'utf8');

    const store = createBoardStore(path, null);
    const loaded = await store.read();
    expect(loaded.columns).toHaveLength(4);

    const entries = await fs.readdir(dir);
    expect(entries.some((e) => e.startsWith('corrupt-'))).toBe(true);
  });

  it('is generic over the stored shape', async () => {
    const path = join(dir, 'thing.json');
    const store = new JsonStore<{ n: number }>(
      path,
      () => ({ n: 0 }),
      (raw) => raw as { n: number },
    );
    await store.write({ n: 42 });
    expect((await store.read()).n).toBe(42);
  });
});

describe('migrate', () => {
  it('falls back to a default board for junk input', () => {
    expect(migrate(null, null).columns).toHaveLength(4);
    expect(migrate('nonsense', null).columns).toHaveLength(4);
    expect(migrate({ columns: [] }, null).columns).toHaveLength(4);
  });

  it('fills in missing card fields rather than dropping the card', () => {
    const raw = {
      version: 1,
      columns: [{ id: 'c1', title: 'Todo', position: 0 }],
      cards: [{ id: 'k1', columnId: 'c1', title: 'Half a card' }],
    };
    const out = migrate(raw, null);
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0].priority).toBe('normal');
    expect(out.cards[0].labels).toEqual([]);
    expect(out.cards[0].config.allowedTools).toEqual([]);
    expect(out.cards[0].runs).toEqual([]);
  });

  it('reparents a card whose column was hand-deleted from the file', () => {
    const raw = {
      version: 1,
      columns: [{ id: 'c1', title: 'Todo', position: 0 }],
      cards: [{ id: 'k1', columnId: 'gone', title: 'Orphan' }],
    };
    const out = migrate(raw, null);
    // The card must remain reachable, not become invisible.
    expect(out.cards[0].columnId).toBe('c1');
  });

  it('stamps the current schema version', () => {
    expect(migrate({ columns: [{ id: 'a', title: 'A', position: 0 }] }, null).version).toBe(
      BOARD_SCHEMA_VERSION,
    );
  });

  it('truncates over-long run history from an older file', () => {
    const runs = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}` }));
    const raw = {
      columns: [{ id: 'c1', title: 'Todo', position: 0 }],
      cards: [{ id: 'k1', columnId: 'c1', title: 'Busy', runs }],
    };
    expect(migrate(raw, null).cards[0].runs).toHaveLength(25);
  });
});
