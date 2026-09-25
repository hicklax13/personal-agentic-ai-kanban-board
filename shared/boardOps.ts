/**
 * Pure, immutable operations over BoardState.
 *
 * These live in `shared` rather than in the main process on purpose: the
 * renderer applies them for instant UI feedback and the test suite exercises
 * the exact same functions under plain Node. One implementation, no drift
 * between "what the UI did" and "what got saved".
 */
import type {
  AgentRun,
  BoardState,
  Card,
  CardAgentConfig,
  CardWorkflowPatch,
  ChatSession,
  Column,
  Priority,
} from './types.js';

export const MAX_RUNS_PER_CARD = 25;

/** Position step. Leaving gaps lets a card slot between two neighbours without renumbering. */
const POSITION_STEP = 1000;

function nowIso(): string {
  return new Date().toISOString();
}

export function uid(): string {
  // crypto.randomUUID exists in both Electron's renderer and modern Node.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function touch(state: BoardState): BoardState {
  return { ...state, updatedAt: nowIso() };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function cardsInColumn(state: BoardState, columnId: string): Card[] {
  return state.cards
    .filter((c) => c.columnId === columnId)
    .sort((a, b) => a.position - b.position);
}

export function sortedColumns(state: BoardState): Column[] {
  return [...state.columns].sort((a, b) => a.position - b.position);
}

export function findCard(state: BoardState, cardId: string): Card | undefined {
  return state.cards.find((c) => c.id === cardId);
}

function nextPosition(state: BoardState, columnId: string): number {
  const existing = cardsInColumn(state, columnId);
  if (existing.length === 0) return POSITION_STEP;
  return existing[existing.length - 1].position + POSITION_STEP;
}

// ---------------------------------------------------------------------------
// Column CRUD
// ---------------------------------------------------------------------------

export function addColumn(state: BoardState, title: string, accent = '#6b7280'): BoardState {
  const position = state.columns.length
    ? Math.max(...state.columns.map((c) => c.position)) + 1
    : 0;
  const column: Column = { id: uid(), title, position, wipLimit: null, accent };
  return touch({ ...state, columns: [...state.columns, column] });
}

export function updateColumn(
  state: BoardState,
  columnId: string,
  patch: Partial<Omit<Column, 'id'>>,
): BoardState {
  return touch({
    ...state,
    columns: state.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)),
  });
}

/**
 * Deleting a column must not silently delete the user's cards. Callers choose:
 * move them somewhere safe, or explicitly ask for cascade.
 */
export function deleteColumn(
  state: BoardState,
  columnId: string,
  options: { cascade?: boolean; moveToColumnId?: string } = {},
): BoardState {
  const remaining = state.columns.filter((c) => c.id !== columnId);
  if (remaining.length === 0) {
    // Refuse to leave a board with no columns — there would be nowhere to drop.
    return state;
  }

  let cards: Card[];
  if (options.cascade) {
    cards = state.cards.filter((c) => c.columnId !== columnId);
  } else {
    const target =
      options.moveToColumnId && remaining.some((c) => c.id === options.moveToColumnId)
        ? options.moveToColumnId
        : remaining.sort((a, b) => a.position - b.position)[0].id;
    cards = state.cards.map((c) =>
      c.columnId === columnId ? { ...c, columnId: target, updatedAt: nowIso() } : c,
    );
  }

  return touch({ ...state, columns: remaining, cards });
}

export function reorderColumns(state: BoardState, orderedIds: string[]): BoardState {
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  return touch({
    ...state,
    columns: state.columns.map((c) => ({ ...c, position: rank.get(c.id) ?? c.position })),
  });
}

// ---------------------------------------------------------------------------
// Card CRUD
// ---------------------------------------------------------------------------

export function defaultConfig(overrides: Partial<CardAgentConfig> = {}): CardAgentConfig {
  return {
    agentId: null,
    providerId: null,
    model: null,
    effort: null,
    allowedTools: [],
    allowedMcpServers: [],
    allowedPlugins: [],
    allowedSkills: [],
    chatSessionId: null,
    taskPrompt: '',
    workspaceMode: 'board',
    workingDirectory: null,
    ...overrides,
  };
}

export interface NewCardFields {
  /** Chosen by the caller when it needs to know the id before the state updates. */
  id?: string;
  title: string;
  description?: string;
  priority?: Priority;
  config?: Partial<CardAgentConfig>;
  parentId?: string | null;
  scheduledAt?: string | null;
  goalMode?: boolean;
}

export function addCard(state: BoardState, columnId: string, fields: NewCardFields): BoardState {
  const ts = nowIso();
  const card: Card = {
    id: fields.id ?? uid(),
    columnId,
    title: fields.title,
    description: fields.description ?? '',
    priority: fields.priority ?? 'normal',
    labels: [],
    position: nextPosition(state, columnId),
    config: defaultConfig(fields.config),
    lastRunId: null,
    runs: [],
    createdAt: ts,
    updatedAt: ts,
    parentId: fields.parentId ?? null,
    scheduledAt: fields.scheduledAt ?? null,
    goalMode: fields.goalMode ?? false,
    goal: null,
    worktreePath: null,
    blockedReason: null,
  };
  return touch({ ...state, cards: [...state.cards, card] });
}

export function updateCard(
  state: BoardState,
  cardId: string,
  patch: Partial<Omit<Card, 'id' | 'config' | 'runs'>>,
): BoardState {
  return touch({
    ...state,
    cards: state.cards.map((c) =>
      c.id === cardId ? { ...c, ...patch, updatedAt: nowIso() } : c,
    ),
  });
}

export function updateCardConfig(
  state: BoardState,
  cardId: string,
  patch: Partial<CardAgentConfig>,
): BoardState {
  return touch({
    ...state,
    cards: state.cards.map((c) =>
      c.id === cardId
        ? { ...c, config: { ...c.config, ...patch }, updatedAt: nowIso() }
        : c,
    ),
  });
}

/**
 * Remove a card. Cards that were waiting on it lose the link rather than keep
 * pointing at nothing — they stay where they are for the user to decide.
 */
export function deleteCard(state: BoardState, cardId: string): BoardState {
  return touch({
    ...state,
    cards: state.cards
      .filter((c) => c.id !== cardId)
      .map((c) => (c.parentId === cardId ? { ...c, parentId: null, updatedAt: nowIso() } : c)),
  });
}

/**
 * Apply a change the main process made on its own (a schedule firing, a
 * parent finishing, a goal round). A column move lands at the end of the column.
 */
export function applyCardPatch(state: BoardState, cardId: string, patch: CardWorkflowPatch): BoardState {
  const card = findCard(state, cardId);
  if (!card) return state;
  const { columnId, ...fields } = patch;
  let next = state;
  if (columnId && columnId !== card.columnId) {
    next = moveCard(next, cardId, columnId, Number.MAX_SAFE_INTEGER);
  }
  if (Object.keys(fields).length > 0) next = updateCard(next, cardId, fields);
  return next;
}

/**
 * Move a card to `columnId`, inserting at `index` within that column.
 *
 * Positions are recomputed for the destination column only. Rewriting one
 * column keeps drag-and-drop cheap even on a board with hundreds of cards.
 */
export function moveCard(
  state: BoardState,
  cardId: string,
  columnId: string,
  index: number,
): BoardState {
  const card = findCard(state, cardId);
  if (!card) return state;
  if (!state.columns.some((c) => c.id === columnId)) return state;

  const destination = cardsInColumn(state, columnId).filter((c) => c.id !== cardId);
  const clamped = Math.max(0, Math.min(index, destination.length));
  destination.splice(clamped, 0, { ...card, columnId });

  const repositioned = new Map(
    destination.map((c, i) => [c.id, (i + 1) * POSITION_STEP] as const),
  );

  return touch({
    ...state,
    cards: state.cards.map((c) => {
      if (c.id === cardId) {
        return {
          ...c,
          columnId,
          position: repositioned.get(c.id) ?? c.position,
          updatedAt: nowIso(),
        };
      }
      if (repositioned.has(c.id)) {
        return { ...c, position: repositioned.get(c.id) as number };
      }
      return c;
    }),
  });
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * Insert or replace a run on its card. Dispatch emits many updates per run, so
 * this is an upsert rather than an append, and history stays capped.
 */
export function upsertRun(state: BoardState, run: AgentRun): BoardState {
  return touch({
    ...state,
    cards: state.cards.map((c) => {
      if (c.id !== run.cardId) return c;
      const existing = c.runs.findIndex((r) => r.id === run.id);
      const runs =
        existing >= 0
          ? c.runs.map((r, i) => (i === existing ? run : r))
          : [...c.runs, run].slice(-MAX_RUNS_PER_CARD);
      return { ...c, runs, lastRunId: run.id, updatedAt: nowIso() };
    }),
  });
}

export function latestRun(card: Card): AgentRun | undefined {
  if (card.lastRunId) {
    const byId = card.runs.find((r) => r.id === card.lastRunId);
    if (byId) return byId;
  }
  return card.runs[card.runs.length - 1];
}

// ---------------------------------------------------------------------------
// Chat sessions
// ---------------------------------------------------------------------------

export function addChatSession(
  state: BoardState,
  name: string,
  agentId: string | null,
  id: string = uid(),
): BoardState {
  const ts = nowIso();
  const session: ChatSession = {
    id,
    name,
    agentId,
    nativeSessionId: null,
    createdAt: ts,
    updatedAt: ts,
  };
  return touch({ ...state, chatSessions: [...state.chatSessions, session] });
}

export function updateChatSession(
  state: BoardState,
  sessionId: string,
  patch: Partial<Omit<ChatSession, 'id'>>,
): BoardState {
  return touch({
    ...state,
    chatSessions: state.chatSessions.map((s) =>
      s.id === sessionId ? { ...s, ...patch, updatedAt: nowIso() } : s,
    ),
  });
}

export function deleteChatSession(state: BoardState, sessionId: string): BoardState {
  return touch({
    ...state,
    chatSessions: state.chatSessions.filter((s) => s.id !== sessionId),
    // Detach cards so they do not point at a session that no longer exists.
    cards: state.cards.map((c) =>
      c.config.chatSessionId === sessionId
        ? { ...c, config: { ...c.config, chatSessionId: null } }
        : c,
    ),
  });
}
