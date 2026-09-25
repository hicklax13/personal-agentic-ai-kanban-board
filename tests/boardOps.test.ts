import { describe, expect, it } from 'vitest';
import {
  addCard,
  addChatSession,
  addColumn,
  cardsInColumn,
  deleteCard,
  deleteChatSession,
  deleteColumn,
  findCard,
  latestRun,
  moveCard,
  updateCard,
  updateCardConfig,
  updateColumn,
  upsertRun,
} from '../shared/boardOps.js';
import { createDefaultBoard } from '../src/main/store/schema.js';
import type { AgentRun, BoardState } from '../shared/types.js';

function board(): BoardState {
  return createDefaultBoard('C:/workspace');
}

function run(cardId: string, id: string, overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id,
    cardId,
    agentId: 'hermes',
    providerId: null,
    model: null,
    status: 'running',
    prompt: 'p',
    output: '',
    events: [],
    error: null,
    exitCode: null,
    agentSessionId: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    command: null,
    ...overrides,
  };
}

describe('columns', () => {
  it('adds a column at the end', () => {
    const next = addColumn(board(), 'Blocked');
    expect(next.columns).toHaveLength(5);
    expect(next.columns[4].title).toBe('Blocked');
  });

  it('renames a column without touching others', () => {
    const b = board();
    const target = b.columns[1].id;
    const next = updateColumn(b, target, { title: 'Doing' });
    expect(next.columns[1].title).toBe('Doing');
    expect(next.columns[0].title).toBe(b.columns[0].title);
  });

  it('reparents cards instead of deleting them when a column is removed', () => {
    const b = board();
    const from = b.columns[0].id;
    const cardCount = cardsInColumn(b, from).length;
    expect(cardCount).toBeGreaterThan(0);

    const next = deleteColumn(b, from);
    expect(next.columns).toHaveLength(3);
    // The card survived and moved to the new first column.
    expect(next.cards).toHaveLength(b.cards.length);
    expect(cardsInColumn(next, next.columns[0].id)).toHaveLength(cardCount);
  });

  it('deletes cards when cascade is requested', () => {
    const b = board();
    const from = b.columns[0].id;
    const next = deleteColumn(b, from, { cascade: true });
    expect(next.cards).toHaveLength(0);
  });

  it('refuses to delete the last remaining column', () => {
    let b = board();
    for (const c of b.columns.slice(1)) b = deleteColumn(b, c.id, { cascade: true });
    expect(b.columns).toHaveLength(1);
    const next = deleteColumn(b, b.columns[0].id, { cascade: true });
    expect(next.columns).toHaveLength(1);
  });
});

describe('cards', () => {
  it('adds a card to the requested column', () => {
    const b = board();
    const col = b.columns[2].id;
    const next = addCard(b, col, { title: 'Ship it', priority: 'high' });
    const created = next.cards[next.cards.length - 1];
    expect(created.columnId).toBe(col);
    expect(created.priority).toBe('high');
    expect(created.config.allowedTools).toEqual([]);
  });

  it('updates card fields and bumps updatedAt', async () => {
    const b = board();
    const id = b.cards[0].id;
    await new Promise((r) => setTimeout(r, 2));
    const next = updateCard(b, id, { title: 'Renamed' });
    const card = findCard(next, id);
    expect(card?.title).toBe('Renamed');
    expect(card?.updatedAt).not.toBe(b.cards[0].updatedAt);
  });

  it('merges config patches rather than replacing the config', () => {
    const b = board();
    const id = b.cards[0].id;
    let next = updateCardConfig(b, id, { agentId: 'hermes' });
    next = updateCardConfig(next, id, { model: 'deepseek-flash' });
    const card = findCard(next, id);
    expect(card?.config.agentId).toBe('hermes');
    expect(card?.config.model).toBe('deepseek-flash');
    // The seeded prompt must survive both patches.
    expect(card?.config.taskPrompt).toContain('PONG');
  });

  it('deletes a card', () => {
    const b = board();
    const next = deleteCard(b, b.cards[0].id);
    expect(next.cards).toHaveLength(0);
  });
});

describe('moveCard', () => {
  it('moves a card to another column', () => {
    const b = board();
    const cardId = b.cards[0].id;
    const target = b.columns[1].id;
    const next = moveCard(b, cardId, target, 0);
    expect(findCard(next, cardId)?.columnId).toBe(target);
  });

  it('reorders within a column and keeps positions strictly increasing', () => {
    let b = board();
    const col = b.columns[0].id;
    b = addCard(b, col, { title: 'second' });
    b = addCard(b, col, { title: 'third' });

    const ordered = cardsInColumn(b, col);
    expect(ordered.map((c) => c.title)).toEqual([ordered[0].title, 'second', 'third']);

    // Move the last card to the front.
    const moved = moveCard(b, ordered[2].id, col, 0);
    const after = cardsInColumn(moved, col);
    expect(after[0].title).toBe('third');
    expect(after.map((c) => c.position)).toEqual([...after.map((c) => c.position)].sort((a, x) => a - x));
  });

  it('clamps an out-of-range index instead of losing the card', () => {
    const b = board();
    const cardId = b.cards[0].id;
    const target = b.columns[3].id;
    const next = moveCard(b, cardId, target, 9999);
    expect(findCard(next, cardId)?.columnId).toBe(target);
    expect(cardsInColumn(next, target)).toHaveLength(1);
  });

  it('ignores a move to a column that does not exist', () => {
    const b = board();
    const next = moveCard(b, b.cards[0].id, 'no-such-column', 0);
    expect(next).toBe(b);
  });
});

describe('runs', () => {
  it('appends a new run and marks it as latest', () => {
    const b = board();
    const cardId = b.cards[0].id;
    const next = upsertRun(b, run(cardId, 'r1'));
    const card = findCard(next, cardId);
    expect(card?.runs).toHaveLength(1);
    expect(card?.lastRunId).toBe('r1');
    expect(latestRun(card!)?.id).toBe('r1');
  });

  it('replaces an existing run in place rather than appending duplicates', () => {
    const b = board();
    const cardId = b.cards[0].id;
    let next = upsertRun(b, run(cardId, 'r1', { output: 'partial' }));
    next = upsertRun(next, run(cardId, 'r1', { output: 'complete', status: 'succeeded' }));
    const card = findCard(next, cardId);
    expect(card?.runs).toHaveLength(1);
    expect(card?.runs[0].output).toBe('complete');
    expect(card?.runs[0].status).toBe('succeeded');
  });

  it('caps run history so the board file cannot grow without bound', () => {
    let b = board();
    const cardId = b.cards[0].id;
    for (let i = 0; i < 40; i++) b = upsertRun(b, run(cardId, `r${i}`));
    expect(findCard(b, cardId)?.runs.length).toBe(25);
  });
});

describe('chat sessions', () => {
  it('creates a session', () => {
    const next = addChatSession(board(), 'Refactor thread', 'claude-code');
    expect(next.chatSessions).toHaveLength(1);
    expect(next.chatSessions[0].name).toBe('Refactor thread');
  });

  it('detaches cards when a session is deleted', () => {
    let b = addChatSession(board(), 'Thread', 'hermes');
    const sessionId = b.chatSessions[0].id;
    const cardId = b.cards[0].id;
    b = updateCardConfig(b, cardId, { chatSessionId: sessionId });
    expect(findCard(b, cardId)?.config.chatSessionId).toBe(sessionId);

    const next = deleteChatSession(b, sessionId);
    expect(next.chatSessions).toHaveLength(0);
    expect(findCard(next, cardId)?.config.chatSessionId).toBeNull();
  });
});
