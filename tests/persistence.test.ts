import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBoardStore, JsonStore } from '../src/main/store/jsonStore.js';
import { BOARD_SCHEMA_VERSION, createDefaultBoard, migrate } from '../src/main/store/schema.js';
import { addCard } from '../shared/boardOps.js';
import { FLOW_COLUMNS } from '../shared/flow.js';

let dir: string;

const WORKFLOW_TITLES = FLOW_COLUMNS.map((c) => c.title);

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

    expect(loaded.columns.map((c) => c.title)).toEqual(WORKFLOW_TITLES);
    // The file must exist on disk after the first read, not just in memory.
    const onDisk = JSON.parse(await fs.readFile(path, 'utf8')) as { columns: unknown[] };
    expect(onDisk.columns).toHaveLength(8);
  });

  it('round-trips a board across a simulated restart', async () => {
    const path = join(dir, 'board.json');

    const first = createBoardStore(path, 'C:/ws');
    let state = await first.read();
    state = addCard(state, state.columns[1].id, {
      title: 'Persisted card',
      config: { taskPrompt: 'do the thing', agentId: 'hermes', model: 'deepseek-flash', workspaceMode: 'worktree' },
      scheduledAt: '2030-01-02T03:04:00.000Z',
      goalMode: true,
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
    expect(card?.config.workspaceMode).toBe('worktree');
    expect(card?.scheduledAt).toBe('2030-01-02T03:04:00.000Z');
    expect(card?.goalMode).toBe(true);
    expect(card?.columnId).toBe(reloaded.columns[1].id);
  });

  it('leaves no temp files behind after a write', async () => {
    const path = join(dir, 'board.json');
    const store = createBoardStore(path, null);
    await store.write(createDefaultBoard(null));
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.includes('.tmp'))).toHaveLength(0);
  });

  it('queues overlapping writes so the last one wins and none collide', async () => {
    const path = join(dir, 'thing.json');
    const store = new JsonStore<{ n: number }>(
      path,
      () => ({ n: 0 }),
      (raw) => raw as { n: number },
    );
    await Promise.all(Array.from({ length: 25 }, (_, n) => store.write({ n })));
    expect((await store.read()).n).toBe(24);
    expect((await fs.readdir(dir)).filter((e) => e.includes('.tmp'))).toHaveLength(0);
  });

  it('quarantines a corrupt file rather than crashing', async () => {
    const path = join(dir, 'board.json');
    await fs.writeFile(path, '{ this is not json', 'utf8');

    const store = createBoardStore(path, null);
    const loaded = await store.read();
    expect(loaded.columns).toHaveLength(8);

    const entries = await fs.readdir(dir);
    expect(entries.some((e) => e.startsWith('corrupt-'))).toBe(true);
  });

  it('keeps a one-time copy of a version 1 board before upgrading it', async () => {
    const path = join(dir, 'board.json');
    const v1 = JSON.stringify({ version: 1, columns: [{ id: 'b', title: 'Backlog', position: 0 }], cards: [] });
    await fs.writeFile(path, v1, 'utf8');

    const store = createBoardStore(path, null);
    await store.read();
    const backup = join(dir, 'board.v1-backup.json');
    expect(await fs.readFile(backup, 'utf8')).toBe(v1);

    // A later launch, after the upgraded board was saved, makes no new copy.
    await store.write(await store.read());
    await createBoardStore(path, null).read();
    expect((await fs.readdir(dir)).filter((e) => e.includes('backup'))).toEqual(['board.v1-backup.json']);
    expect(await fs.readFile(backup, 'utf8')).toBe(v1);
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
    expect(migrate(null, null).columns).toHaveLength(8);
    expect(migrate('nonsense', null).columns).toHaveLength(8);
    expect(migrate({ columns: [] }, null).columns).toHaveLength(8);
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
    expect(out.cards[0].config.workspaceMode).toBe('board');
    expect(out.cards[0].runs).toEqual([]);
    expect(out.cards[0]).toMatchObject({
      parentId: null,
      scheduledAt: null,
      goalMode: false,
      goal: null,
      worktreePath: null,
      blockedReason: null,
    });
  });

  it('reparents a card whose column was hand-deleted from the file', () => {
    const raw = {
      version: 2,
      columns: [{ id: 'c1', title: 'Todo', position: 0 }],
      cards: [{ id: 'k1', columnId: 'gone', title: 'Orphan' }],
    };
    const out = migrate(raw, null);
    // The card must remain reachable, not become invisible.
    expect(out.cards[0].columnId).toBe('c1');
  });

  it('upgrades a version 1 board to the eight workflow columns without moving a card', () => {
    const raw = {
      version: 1,
      columns: [
        { id: 'b', title: 'Backlog', position: 0 },
        { id: 'p', title: 'In Progress', position: 1 },
        { id: 'r', title: 'In Review', position: 2 },
        { id: 'd', title: 'Done', position: 3 },
        { id: 'i', title: 'Ideas', position: 4 },
      ],
      cards: [
        { id: 'k1', columnId: 'b', title: 'Waiting' },
        { id: 'k2', columnId: 'p', title: 'Going' },
        { id: 'k3', columnId: 'r', title: 'Check me' },
        { id: 'k4', columnId: 'i', title: 'Someday' },
      ],
    };
    const out = migrate(raw, null);

    expect(out.columns.map((c) => c.title)).toEqual([...WORKFLOW_TITLES, 'Ideas']);
    const titleOf = (cardId: string): string =>
      out.columns.find((c) => c.id === out.cards.find((k) => k.id === cardId)?.columnId)?.title ?? '';
    // Same column ids, new names: the cards never moved.
    expect(titleOf('k1')).toBe('TODO');
    expect(titleOf('k2')).toBe('RUNNING');
    expect(titleOf('k3')).toBe('REVIEW');
    expect(titleOf('k4')).toBe('Ideas');
    expect(out.columns.find((c) => c.title === 'DONE')?.id).toBe('d');
  });

  it("leaves a version 2 board's columns as the user arranged them", () => {
    const raw = {
      version: 2,
      columns: [
        { id: 'x', title: 'My queue', position: 0 },
        { id: 'y', title: 'Shipped', position: 1 },
      ],
      cards: [],
    };
    expect(migrate(raw, null).columns.map((c) => c.title)).toEqual(['My queue', 'Shipped']);
  });

  it('keeps the workflow fields and drops a parent link that points nowhere', () => {
    const raw = {
      version: 2,
      columns: [{ id: 'c1', title: 'TODO', position: 0 }],
      cards: [
        { id: 'k1', columnId: 'c1', title: 'Parent' },
        {
          id: 'k2',
          columnId: 'c1',
          title: 'Child',
          parentId: 'k1',
          goalMode: true,
          goal: { status: 'running', round: 2, maxRounds: 5, reason: 'more tests', updatedAt: 'x' },
          config: { workspaceMode: 'dir', workingDirectory: 'C:/work' },
        },
        { id: 'k3', columnId: 'c1', title: 'Orphan link', parentId: 'deleted-card' },
        { id: 'k4', columnId: 'c1', title: 'Old folder', config: { workingDirectory: 'C:/old' } },
      ],
    };
    const out = migrate(raw, null);
    const card = (id: string) => out.cards.find((c) => c.id === id);
    expect(card('k2')?.parentId).toBe('k1');
    expect(card('k2')?.goal).toMatchObject({ status: 'running', round: 2, maxRounds: 5 });
    expect(card('k2')?.config.workspaceMode).toBe('dir');
    expect(card('k3')?.parentId).toBeNull();
    // A folder saved before workspace modes existed keeps being used.
    expect(card('k4')?.config.workspaceMode).toBe('dir');
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
