/**
 * The board's workflow: which column means what, and what should happen next.
 *
 * The columns and their meaning follow Hermes Agent's own Kanban, which this
 * layout is modelled on:
 *
 *   TRIAGE → TODO → SCHEDULED → READY → RUNNING → BLOCKED → REVIEW → DONE
 *
 * READY means "run this": the app starts READY cards by itself, highest
 * priority first. A card whose parent is unfinished waits in TODO and moves to
 * READY once the parent reaches DONE. A scheduled card waits in SCHEDULED until
 * its time. A finished run goes to REVIEW, a failed one to BLOCKED, and a
 * Goal-mode card goes to DONE only when its judge agrees.
 *
 * Everything here is pure — board and clock in, planned changes out — so the
 * rules can be tested without Electron, timers or agents. Columns are found by
 * title, which is how the rest of the app already recognises them.
 */
import type { AgentRun, BoardState, Card, Column, Priority, RunStatus } from './types.js';

export type FlowKey =
  | 'triage'
  | 'todo'
  | 'scheduled'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'review'
  | 'done';

export interface FlowColumnSpec {
  key: FlowKey;
  title: string;
  accent: string;
  /** Older titles that mean the same thing, recognised when upgrading a board. */
  aliases: string[];
}

export const FLOW_COLUMNS: FlowColumnSpec[] = [
  { key: 'triage', title: 'TRIAGE', accent: '#8b5cf6', aliases: [] },
  { key: 'todo', title: 'TODO', accent: '#6b7280', aliases: ['backlog', 'to do'] },
  { key: 'scheduled', title: 'SCHEDULED', accent: '#0891b2', aliases: [] },
  { key: 'ready', title: 'READY', accent: '#0d9488', aliases: [] },
  { key: 'running', title: 'RUNNING', accent: '#2563eb', aliases: ['in progress', 'doing'] },
  { key: 'blocked', title: 'BLOCKED', accent: '#dc2626', aliases: [] },
  { key: 'review', title: 'REVIEW', accent: '#b45309', aliases: ['in review'] },
  { key: 'done', title: 'DONE', accent: '#15803d', aliases: [] },
];

/** How many runs the app starts on its own at the same time. */
export const MAX_AUTO_RUNS = 3;

export const ACTIVE_RUN_STATUSES: RunStatus[] = ['queued', 'acknowledged', 'running'];

const norm = (s: string): string => s.trim().toLowerCase();

function spec(key: FlowKey): FlowColumnSpec {
  return FLOW_COLUMNS.find((s) => s.key === key) as FlowColumnSpec;
}

/**
 * The column playing a workflow role. An exact title beats an alias, so a board
 * with both "TODO" and "Backlog" treats "TODO" as the TODO column.
 */
export function flowColumn(columns: Column[], key: FlowKey): Column | undefined {
  const s = spec(key);
  const title = norm(s.title);
  return (
    columns.find((c) => norm(c.title) === title) ??
    columns.find((c) => s.aliases.includes(norm(c.title)))
  );
}

export function flowKeyOf(columns: Column[], columnId: string): FlowKey | null {
  for (const s of FLOW_COLUMNS) {
    if (flowColumn(columns, s.key)?.id === columnId) return s.key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parents
// ---------------------------------------------------------------------------

export function parentOf(board: BoardState, card: Pick<Card, 'parentId'>): Card | undefined {
  return card.parentId ? board.cards.find((c) => c.id === card.parentId) : undefined;
}

/** True when no unfinished parent holds this card back. A missing parent gates nothing. */
export function isParentDone(board: BoardState, card: Pick<Card, 'parentId'>): boolean {
  const parent = parentOf(board, card);
  if (!parent) return true;
  const done = flowColumn(board.columns, 'done');
  return Boolean(done && parent.columnId === done.id);
}

/** Every card that depends on `cardId`, directly or further down the chain. */
export function descendantsOf(board: BoardState, cardId: string): Set<string> {
  const found = new Set<string>();
  const queue = [cardId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const c of board.cards) {
      if (c.parentId === id && !found.has(c.id)) {
        found.add(c.id);
        queue.push(c.id);
      }
    }
  }
  return found;
}

/** Cards that can be `cardId`'s parent without making a loop. Null means a new card. */
export function parentCandidates(board: BoardState, cardId: string | null): Card[] {
  const below = cardId ? descendantsOf(board, cardId) : new Set<string>();
  return board.cards.filter((c) => c.id !== cardId && !below.has(c.id));
}

// ---------------------------------------------------------------------------
// Placement and planning
// ---------------------------------------------------------------------------

export function isDue(card: Pick<Card, 'scheduledAt'>, now: Date): boolean {
  if (!card.scheduledAt) return false;
  const at = Date.parse(card.scheduledAt);
  return Number.isFinite(at) && at <= now.getTime();
}

/**
 * The column a new card belongs in. A future schedule wins (it waits in
 * SCHEDULED), then an unfinished parent (it waits in TODO); otherwise it lands
 * where it was created. Each falls back to the requested column when the board
 * has no such column.
 */
export function placeNewCard(
  board: BoardState,
  requestedColumnId: string,
  fields: Pick<Card, 'scheduledAt' | 'parentId'>,
  now: Date,
): string {
  if (fields.scheduledAt && !isDue(fields, now)) {
    return flowColumn(board.columns, 'scheduled')?.id ?? requestedColumnId;
  }
  if (!isParentDone(board, fields)) {
    return flowColumn(board.columns, 'todo')?.id ?? requestedColumnId;
  }
  return requestedColumnId;
}

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

export interface FlowMove {
  cardId: string;
  to: FlowKey;
}

export interface FlowPlan {
  moves: FlowMove[];
  /** Cards to start now, best first. */
  start: string[];
}

/**
 * What the workflow should do next.
 *
 * - A due card in SCHEDULED moves to READY — or to TODO while its parent is unfinished.
 * - A card in TODO whose parent has reached DONE moves to READY. A TODO card with
 *   no parent is the user's to move and is never promoted.
 * - A card in READY whose parent is unfinished goes back to TODO to wait.
 * - READY cards that have an assignee start, highest priority first, up to `slots`.
 *
 * Running cards are never moved; the run's own outcome decides where they go.
 */
export function planFlow(
  board: BoardState,
  now: Date,
  opts: { isRunning(cardId: string): boolean; slots: number },
): FlowPlan {
  const id = (key: FlowKey): string | undefined => flowColumn(board.columns, key)?.id;
  const scheduled = id('scheduled');
  const todo = id('todo');
  const ready = id('ready');

  const moves: FlowMove[] = [];
  const columnAfter = new Map(board.cards.map((c) => [c.id, c.columnId] as const));

  for (const card of board.cards) {
    if (opts.isRunning(card.id)) continue;
    const parentDone = isParentDone(board, card);
    let to: FlowKey | null = null;
    if (scheduled && card.columnId === scheduled && isDue(card, now)) {
      to = parentDone ? 'ready' : 'todo';
    } else if (todo && card.columnId === todo && card.parentId && parentDone) {
      to = 'ready';
    } else if (ready && card.columnId === ready && !parentDone) {
      to = 'todo';
    }
    const target = to ? id(to) : undefined;
    if (to && target && target !== card.columnId) {
      moves.push({ cardId: card.id, to });
      columnAfter.set(card.id, target);
    }
  }

  const start =
    ready && opts.slots > 0
      ? board.cards
          .filter(
            (c) =>
              columnAfter.get(c.id) === ready &&
              Boolean(c.config.agentId) &&
              !opts.isRunning(c.id) &&
              isParentDone(board, c),
          )
          .sort(
            (a, b) =>
              PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.position - b.position,
          )
          .slice(0, opts.slots)
          .map((c) => c.id)
      : [];

  return { moves, start };
}

// ---------------------------------------------------------------------------
// Run outcomes
// ---------------------------------------------------------------------------

export type RunOutcome =
  | 'start'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'goal-done'
  | 'goal-blocked';

const OUTCOME_TARGET: Record<RunOutcome, FlowKey> = {
  start: 'running',
  succeeded: 'review',
  failed: 'blocked',
  // Not READY: a READY card would start again straight away.
  cancelled: 'todo',
  'goal-done': 'done',
  'goal-blocked': 'blocked',
};

/**
 * The column a card moves to when its run reaches `outcome`, or null to leave
 * it where it is.
 *
 * A board without the workflow columns (a layout the user built by hand) keeps
 * the older behaviour: move forward only, by position, and only on start and
 * success — guessing on anything else would scatter the user's cards.
 */
export function outcomeColumn(
  columns: Column[],
  outcome: RunOutcome,
  currentColumnId: string,
): string | null {
  const target = flowColumn(columns, OUTCOME_TARGET[outcome]);
  if (target) return target.id === currentColumnId ? null : target.id;

  if (outcome !== 'start' && outcome !== 'succeeded') return null;
  const ordered = [...columns].sort((a, b) => a.position - b.position);
  const fallback = outcome === 'start' ? ordered[1] : ordered[ordered.length - 1];
  if (!fallback || fallback.id === currentColumnId) return null;
  const from = ordered.findIndex((c) => c.id === currentColumnId);
  const to = ordered.findIndex((c) => c.id === fallback.id);
  return to > from ? fallback.id : null;
}

// ---------------------------------------------------------------------------
// Start-up repair
// ---------------------------------------------------------------------------

export const INTERRUPTED_REASON =
  'Interrupted — the app closed while this was running. Move it to READY to run it again.';

/**
 * Tidy up after the app closed in the middle of a run.
 *
 * A run still marked active can never finish, so it becomes cancelled. A card
 * left in RUNNING moves to where its last run says it belongs — REVIEW after a
 * success, otherwise BLOCKED with the reason — instead of looking busy forever.
 * A Goal loop that was going is marked stopped.
 */
export function repairInterrupted(
  board: BoardState,
  now: Date,
): { board: BoardState; repaired: string[] } {
  const ts = now.toISOString();
  const running = flowColumn(board.columns, 'running')?.id;
  const blocked = flowColumn(board.columns, 'blocked')?.id;
  const review = flowColumn(board.columns, 'review')?.id;
  const repaired: string[] = [];

  const cards = board.cards.map((card): Card => {
    const hasActive = card.runs.some((r) => ACTIVE_RUN_STATUSES.includes(r.status));
    const inRunning = Boolean(running && card.columnId === running);
    const goalRunning = card.goal?.status === 'running';
    if (!hasActive && !inRunning && !goalRunning) return card;
    repaired.push(card.id);

    const runs = card.runs.map(
      (r): AgentRun =>
        ACTIVE_RUN_STATUSES.includes(r.status)
          ? {
              ...r,
              status: 'cancelled',
              error: r.error ?? 'The app closed before this run finished.',
              endedAt: r.endedAt ?? ts,
            }
          : r,
    );

    let columnId = card.columnId;
    let blockedReason = card.blockedReason;
    if (inRunning) {
      const last = runs[runs.length - 1];
      if (last?.status === 'succeeded' && review && !goalRunning) {
        columnId = review;
      } else if (blocked) {
        columnId = blocked;
        blockedReason =
          last?.status === 'failed' && last.error ? `Last run failed: ${last.error}` : INTERRUPTED_REASON;
      }
    }

    return {
      ...card,
      runs,
      columnId,
      blockedReason,
      goal:
        goalRunning && card.goal
          ? { ...card.goal, status: 'stopped', reason: 'Interrupted — the app closed.', updatedAt: ts }
          : card.goal,
      updatedAt: ts,
    };
  });

  return { board: { ...board, cards }, repaired };
}
