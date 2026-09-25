import { describe, expect, it } from 'vitest';
import { PatchLog } from '../src/main/store/patchLog.js';
import { addCard, applyCardPatch, findCard, moveCard, upsertRun } from '../shared/boardOps.js';
import { flowColumn, type FlowKey } from '../shared/flow.js';
import { createDefaultBoard } from '../src/main/store/schema.js';
import type { AgentRun, BoardState } from '../shared/types.js';

function start(): BoardState {
  const b = { ...createDefaultBoard(null), cards: [] };
  return addCard(b, col(b, 'ready'), { id: 'x', title: 'Task' });
}

function col(b: BoardState, key: FlowKey): string {
  return (flowColumn(b.columns, key) as { id: string }).id;
}

const where = (b: BoardState): string => findCard(b, 'x')?.columnId ?? '';

const run: AgentRun = {
  id: 'r1',
  cardId: 'x',
  agentId: 'codex',
  providerId: null,
  model: null,
  status: 'succeeded',
  prompt: '',
  output: 'done',
  events: [],
  error: null,
  exitCode: 0,
  agentSessionId: null,
  startedAt: '',
  endedAt: '',
  command: null,
};

describe('PatchLog', () => {
  it('lays a change the window had not seen back over its save', () => {
    const log = new PatchLog();
    const windowCopy = start();
    let main = windowCopy;
    const seq = log.record('x', { columnId: col(main, 'running') });
    main = applyCardPatch(main, 'x', { columnId: col(main, 'running') });

    // The window saves a board put together before the move reached it.
    const merged = log.merge(main, windowCopy, seq - 1);
    expect(where(merged)).toBe(col(main, 'running'));
  });

  it('keeps what the user did after seeing a change', () => {
    const log = new PatchLog();
    let main = start();
    const seq = log.record('x', { columnId: col(main, 'review') });
    main = applyCardPatch(main, 'x', { columnId: col(main, 'review') });

    // The window applied the move, then the user dragged the card to DONE.
    const windowCopy = moveCard(main, 'x', col(main, 'done'), 0);
    expect(where(log.merge(main, windowCopy, seq))).toBe(col(main, 'done'));
  });

  it('re-applies only the fields the window has not seen', () => {
    const log = new PatchLog();
    let main = start();
    const first = log.record('x', { columnId: col(main, 'review') });
    main = applyCardPatch(main, 'x', { columnId: col(main, 'review') });
    const windowCopy = moveCard(main, 'x', col(main, 'done'), 0); // user drags after seeing #1

    log.record('x', { blockedReason: 'later note' }); // #2, not yet seen
    main = applyCardPatch(main, 'x', { blockedReason: 'later note' });

    const merged = log.merge(main, windowCopy, first);
    expect(where(merged)).toBe(col(main, 'done'));
    expect(findCard(merged, 'x')?.blockedReason).toBe('later note');
  });

  it('forgets changes once the window has seen them', () => {
    const log = new PatchLog();
    let main = start();
    const seq = log.record('x', { columnId: col(main, 'running') });
    main = applyCardPatch(main, 'x', { columnId: col(main, 'running') });
    log.merge(main, main, seq);

    // A later save that moves the card is taken as it is.
    const windowCopy = moveCard(main, 'x', col(main, 'todo'), 0);
    expect(where(log.merge(main, windowCopy, 0))).toBe(col(main, 'todo'));
  });

  it('always keeps the main copy of run history, goal and worktree', () => {
    const log = new PatchLog();
    const windowCopy = start();
    let main = upsertRun(windowCopy, run);
    main = applyCardPatch(main, 'x', {
      goal: { status: 'done', round: 1, maxRounds: 3, reason: 'ok', updatedAt: '' },
      worktreePath: 'C:/repo/.worktrees/x',
    });
    const merged = findCard(log.merge(main, windowCopy, log.latest), 'x');
    expect(merged?.runs.map((r) => r.id)).toEqual(['r1']);
    expect(merged?.goal?.status).toBe('done');
    expect(merged?.worktreePath).toBe('C:/repo/.worktrees/x');
  });

  it('takes a card the main process has never seen exactly as the window made it', () => {
    const log = new PatchLog();
    const main = start();
    const windowCopy = addCard(main, col(main, 'triage'), { id: 'new', title: 'Fresh' });
    expect(findCard(log.merge(main, windowCopy, 0), 'new')?.title).toBe('Fresh');
  });
});
