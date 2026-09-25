import { describe, expect, it } from 'vitest';
import {
  descendantsOf,
  flowColumn,
  flowKeyOf,
  INTERRUPTED_REASON,
  isParentDone,
  outcomeColumn,
  parentCandidates,
  placeNewCard,
  planFlow,
  repairInterrupted,
  type FlowKey,
} from '../shared/flow.js';
import { addCard, applyCardPatch, deleteCard, findCard } from '../shared/boardOps.js';
import { createDefaultBoard } from '../src/main/store/schema.js';
import type { AgentRun, BoardState, Card } from '../shared/types.js';

const NOW = new Date('2026-09-25T12:00:00.000Z');
const LATER = '2026-09-25T13:00:00.000Z';
const EARLIER = '2026-09-25T11:00:00.000Z';

function empty(): BoardState {
  return { ...createDefaultBoard('C:/ws'), cards: [] };
}

function col(b: BoardState, key: FlowKey): string {
  return (flowColumn(b.columns, key) as { id: string }).id;
}

/** Add a card to a workflow column and return the new board plus the card's id. */
function put(
  b: BoardState,
  key: FlowKey,
  fields: Partial<Card> & { agentId?: string | null } = {},
): [BoardState, string] {
  const { agentId = 'codex', ...rest } = fields;
  const id = `card-${b.cards.length + 1}`;
  const next = addCard(b, col(b, key), {
    id,
    title: rest.title ?? id,
    priority: rest.priority,
    parentId: rest.parentId ?? null,
    scheduledAt: rest.scheduledAt ?? null,
    goalMode: rest.goalMode,
    config: { agentId },
  });
  return [next, id];
}

const idle = { isRunning: () => false, slots: 3 };

function keyOf(b: BoardState, cardId: string): FlowKey | null {
  return flowKeyOf(b.columns, (findCard(b, cardId) as Card).columnId);
}

describe('workflow columns', () => {
  it('a new board has the eight columns in order', () => {
    expect(createDefaultBoard(null).columns.map((c) => c.title)).toEqual([
      'TRIAGE',
      'TODO',
      'SCHEDULED',
      'READY',
      'RUNNING',
      'BLOCKED',
      'REVIEW',
      'DONE',
    ]);
  });

  it('recognises older titles as the same role', () => {
    const b = empty();
    const cols = b.columns.map((c) => (c.title === 'TODO' ? { ...c, title: 'Backlog' } : c));
    expect(flowColumn(cols, 'todo')?.title).toBe('Backlog');
  });

  it('prefers the exact title over an alias', () => {
    const b = empty();
    const cols = [...b.columns, { ...b.columns[0], id: 'extra', title: 'Backlog', position: 99 }];
    expect(flowColumn(cols, 'todo')?.title).toBe('TODO');
  });
});

describe('parents', () => {
  it('a card with no parent, or a missing one, is never held back', () => {
    const b = empty();
    expect(isParentDone(b, { parentId: null })).toBe(true);
    expect(isParentDone(b, { parentId: 'nowhere' })).toBe(true);
  });

  it('a parent counts as finished only in DONE', () => {
    let [b, parent] = put(empty(), 'review');
    expect(isParentDone(b, { parentId: parent })).toBe(false);
    b = applyCardPatch(b, parent, { columnId: col(b, 'done') });
    expect(isParentDone(b, { parentId: parent })).toBe(true);
  });

  it('never offers a card, or anything that depends on it, as its own parent', () => {
    let [b, a] = put(empty(), 'todo');
    let child: string;
    [b, child] = put(b, 'todo', { parentId: a });
    let grandchild: string;
    [b, grandchild] = put(b, 'todo', { parentId: child });
    let other: string;
    [b, other] = put(b, 'todo');

    expect([...descendantsOf(b, a)].sort()).toEqual([child, grandchild].sort());
    expect(parentCandidates(b, a).map((c) => c.id)).toEqual([other]);
    expect(parentCandidates(b, null)).toHaveLength(4);
  });

  it('deleting a parent frees the cards that waited on it', () => {
    let [b, parent] = put(empty(), 'todo');
    let child: string;
    [b, child] = put(b, 'todo', { parentId: parent });
    b = deleteCard(b, parent);
    expect(findCard(b, child)?.parentId).toBeNull();
  });
});

describe('placeNewCard', () => {
  const b = put(empty(), 'review')[0];
  const parent = b.cards[0].id;
  const triage = col(b, 'triage');

  it('keeps a plain card where it was created', () => {
    expect(placeNewCard(b, triage, { scheduledAt: null, parentId: null }, NOW)).toBe(triage);
  });

  it('sends a card scheduled for later to SCHEDULED', () => {
    expect(placeNewCard(b, triage, { scheduledAt: LATER, parentId: null }, NOW)).toBe(col(b, 'scheduled'));
  });

  it('sends a card with an unfinished parent to TODO', () => {
    expect(placeNewCard(b, triage, { scheduledAt: null, parentId: parent }, NOW)).toBe(col(b, 'todo'));
  });

  it('lets a schedule win over a parent: it waits for its time first', () => {
    expect(placeNewCard(b, triage, { scheduledAt: LATER, parentId: parent }, NOW)).toBe(col(b, 'scheduled'));
  });

  it('does not treat a time already passed as a schedule', () => {
    expect(placeNewCard(b, triage, { scheduledAt: EARLIER, parentId: null }, NOW)).toBe(triage);
  });
});

describe('planFlow', () => {
  it('moves a due card from SCHEDULED to READY and starts it', () => {
    const [b, id] = put(empty(), 'scheduled', { scheduledAt: EARLIER });
    const plan = planFlow(b, NOW, idle);
    expect(plan.moves).toEqual([{ cardId: id, to: 'ready' }]);
    expect(plan.start).toEqual([id]);
  });

  it('leaves a card scheduled for later alone', () => {
    const [b] = put(empty(), 'scheduled', { scheduledAt: LATER });
    expect(planFlow(b, NOW, idle)).toEqual({ moves: [], start: [] });
  });

  it('sends a due card whose parent is unfinished to TODO instead', () => {
    let [b, parent] = put(empty(), 'running');
    let id: string;
    [b, id] = put(b, 'scheduled', { scheduledAt: EARLIER, parentId: parent });
    expect(planFlow(b, NOW, idle)).toEqual({ moves: [{ cardId: id, to: 'todo' }], start: [] });
  });

  it('promotes a waiting card to READY once its parent is DONE, and starts it', () => {
    let [b, parent] = put(empty(), 'done');
    let child: string;
    [b, child] = put(b, 'todo', { parentId: parent });
    const plan = planFlow(b, NOW, idle);
    expect(plan.moves).toEqual([{ cardId: child, to: 'ready' }]);
    expect(plan.start).toEqual([child]);
  });

  it('never promotes a TODO card that has no parent — that is the user’s call', () => {
    const [b] = put(empty(), 'todo');
    expect(planFlow(b, NOW, idle)).toEqual({ moves: [], start: [] });
  });

  it('sends a READY card back to TODO while its parent is unfinished', () => {
    let [b, parent] = put(empty(), 'review');
    let child: string;
    [b, child] = put(b, 'ready', { parentId: parent });
    expect(planFlow(b, NOW, idle)).toEqual({ moves: [{ cardId: child, to: 'todo' }], start: [] });
  });

  it('starts READY cards highest priority first, then by position, within the free slots', () => {
    let b = empty();
    let low: string;
    let normal1: string;
    let urgent: string;
    let normal2: string;
    [b, low] = put(b, 'ready', { priority: 'low' });
    [b, normal1] = put(b, 'ready');
    [b, urgent] = put(b, 'ready', { priority: 'urgent' });
    [b, normal2] = put(b, 'ready');
    expect(planFlow(b, NOW, { isRunning: () => false, slots: 3 }).start).toEqual([urgent, normal1, normal2]);
    expect(planFlow(b, NOW, { isRunning: () => false, slots: 0 }).start).toEqual([]);
    void low;
  });

  it('does not start a READY card with no assignee, or one already running', () => {
    let b = empty();
    let running: string;
    [b] = put(b, 'ready', { agentId: null });
    [b, running] = put(b, 'ready');
    expect(planFlow(b, NOW, { isRunning: (id) => id === running, slots: 3 }).start).toEqual([]);
  });
});

describe('outcomeColumn on the workflow board', () => {
  const b = empty();
  const from = col(b, 'running');
  const cases: [Parameters<typeof outcomeColumn>[1], FlowKey][] = [
    ['start', 'running'],
    ['succeeded', 'review'],
    ['failed', 'blocked'],
    ['cancelled', 'todo'],
    ['goal-done', 'done'],
    ['goal-blocked', 'blocked'],
  ];
  for (const [outcome, key] of cases) {
    it(`${outcome} → ${key.toUpperCase()}`, () => {
      const start = outcome === 'start' ? col(b, 'ready') : from;
      expect(outcomeColumn(b.columns, outcome, start)).toBe(col(b, key));
    });
  }

  it('moves a re-run card from DONE back to RUNNING: the column shows what is happening now', () => {
    expect(outcomeColumn(b.columns, 'start', col(b, 'done'))).toBe(col(b, 'running'));
  });
});

describe('repairInterrupted', () => {
  function withRun(b: BoardState, cardId: string, run: Partial<AgentRun>): BoardState {
    return {
      ...b,
      cards: b.cards.map((c) =>
        c.id === cardId
          ? {
              ...c,
              runs: [
                ...c.runs,
                {
                  id: `run-${c.runs.length}`,
                  cardId,
                  agentId: 'codex',
                  providerId: null,
                  model: null,
                  status: 'running',
                  prompt: '',
                  output: '',
                  events: [],
                  error: null,
                  exitCode: null,
                  agentSessionId: null,
                  startedAt: EARLIER,
                  endedAt: null,
                  command: null,
                  ...run,
                },
              ],
            }
          : c,
      ),
    };
  }

  it('cancels a run left active and moves its card out of RUNNING to BLOCKED', () => {
    let [b, id] = put(empty(), 'running');
    b = withRun(b, id, { status: 'running' });
    const { board, repaired } = repairInterrupted(b, NOW);
    expect(repaired).toEqual([id]);
    const card = findCard(board, id) as Card;
    expect(card.runs[0].status).toBe('cancelled');
    expect(card.runs[0].endedAt).toBe(NOW.toISOString());
    expect(keyOf(board, id)).toBe('blocked');
    expect(card.blockedReason).toBe(INTERRUPTED_REASON);
  });

  it('sends a card left in RUNNING after a successful run to REVIEW', () => {
    let [b, id] = put(empty(), 'running');
    b = withRun(b, id, { status: 'succeeded', endedAt: EARLIER });
    const { board } = repairInterrupted(b, NOW);
    expect(keyOf(board, id)).toBe('review');
  });

  it('explains a failed last run instead of calling it interrupted', () => {
    let [b, id] = put(empty(), 'running');
    b = withRun(b, id, { status: 'failed', error: 'quota exceeded', endedAt: EARLIER });
    const card = findCard(repairInterrupted(b, NOW).board, id) as Card;
    expect(card.blockedReason).toBe('Last run failed: quota exceeded');
  });

  it('marks a Goal loop that was going as stopped', () => {
    let [b, id] = put(empty(), 'running', { goalMode: true });
    b = applyCardPatch(b, id, {
      goal: { status: 'running', round: 2, maxRounds: 5, reason: null, updatedAt: EARLIER },
    });
    const card = findCard(repairInterrupted(b, NOW).board, id) as Card;
    expect(card.goal?.status).toBe('stopped');
  });

  it('leaves a quiet board untouched', () => {
    const [b] = put(empty(), 'review');
    const { board, repaired } = repairInterrupted(b, NOW);
    expect(repaired).toEqual([]);
    expect(board.cards).toEqual(b.cards);
  });
});

describe('applyCardPatch', () => {
  it('moves the card to the end of its new column and sets the other fields', () => {
    let [b, a] = put(empty(), 'ready');
    let other: string;
    [b, other] = put(b, 'running');
    b = applyCardPatch(b, a, { columnId: col(b, 'running'), blockedReason: null, worktreePath: 'C:/r/.worktrees/x' });
    const inRunning = b.cards.filter((c) => c.columnId === col(b, 'running')).sort((x, y) => x.position - y.position);
    expect(inRunning.map((c) => c.id)).toEqual([other, a]);
    expect(findCard(b, a)?.worktreePath).toBe('C:/r/.worktrees/x');
  });

  it('ignores a card that no longer exists', () => {
    const b = empty();
    expect(applyCardPatch(b, 'gone', { columnId: col(b, 'done') })).toBe(b);
  });
});
