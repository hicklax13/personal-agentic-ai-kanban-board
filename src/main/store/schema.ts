import { randomUUID } from 'node:crypto';
import type {
  BoardState,
  Card,
  CardAgentConfig,
  Column,
  GoalState,
  Priority,
  WorkspaceMode,
} from '@shared/types';
import { FLOW_COLUMNS, flowColumn } from '@shared/flow';

/**
 * Bump this whenever the on-disk shape changes and add a matching step to
 * `migrate`. Storing the version inside the file (rather than inferring it)
 * means an old board never silently loses fields on first open.
 *
 * v2: the eight workflow columns, plus parent, schedule, Goal mode and
 *     workspace mode on every card.
 */
export const BOARD_SCHEMA_VERSION = 2;

/** Keep run history bounded so a long-lived board file stays small and fast. */
export const MAX_RUNS_PER_CARD = 25;

export const newId = (): string => randomUUID();

export function defaultAgentConfig(overrides: Partial<CardAgentConfig> = {}): CardAgentConfig {
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

export function makeColumn(title: string, position: number, accent: string): Column {
  return { id: newId(), title, position, wipLimit: null, accent };
}

export function makeCard(params: {
  columnId: string;
  title: string;
  description?: string;
  priority?: Priority;
  position: number;
  config?: Partial<CardAgentConfig>;
  parentId?: string | null;
  scheduledAt?: string | null;
  goalMode?: boolean;
}): Card {
  const now = new Date().toISOString();
  return {
    id: newId(),
    columnId: params.columnId,
    title: params.title,
    description: params.description ?? '',
    priority: params.priority ?? 'normal',
    labels: [],
    position: params.position,
    config: defaultAgentConfig(params.config),
    lastRunId: null,
    runs: [],
    createdAt: now,
    updatedAt: now,
    parentId: params.parentId ?? null,
    scheduledAt: params.scheduledAt ?? null,
    goalMode: params.goalMode ?? false,
    goal: null,
    worktreePath: null,
    blockedReason: null,
  };
}

/**
 * Give a board the eight workflow columns without losing a card.
 *
 * A column whose title already means the same thing is renamed rather than
 * replaced, so its cards stay put: Backlog → TODO, In Progress → RUNNING,
 * In Review → REVIEW, Done → DONE. Missing workflow columns are added in
 * order, and any other column the user made is kept, after DONE.
 */
export function upgradeColumns(columns: Column[]): Column[] {
  const used = new Set<string>();
  const workflow = FLOW_COLUMNS.map((spec, i): Column => {
    const match = flowColumn(
      columns.filter((c) => !used.has(c.id)),
      spec.key,
    );
    if (match) {
      used.add(match.id);
      return { ...match, title: spec.title, position: i, accent: spec.accent };
    }
    return makeColumn(spec.title, i, spec.accent);
  });
  const others = columns
    .filter((c) => !used.has(c.id))
    .sort((a, b) => a.position - b.position)
    .map((c, j) => ({ ...c, position: FLOW_COLUMNS.length + j }));
  return [...workflow, ...others];
}

/**
 * The board a brand-new install opens with: the eight workflow columns and a
 * welcome card that doubles as in-app documentation.
 */
export function createDefaultBoard(workspaceRoot: string | null): BoardState {
  const columns = upgradeColumns([]);
  const todo = flowColumn(columns, 'todo') as Column;

  const welcome = makeCard({
    columnId: todo.id,
    title: 'Welcome — open me and press Send to Agent',
    description:
      'Select this card, choose who does it (an account, a connection or an API key) in the ' +
      'right-hand panel, then press "Send to Agent". The reply streams back onto the card. ' +
      'Use "+ New task" on any column to add work: cards in READY start by themselves, a ' +
      'card with a parent waits in TODO until the parent is DONE, and a scheduled card waits ' +
      'in SCHEDULED. Agents, models, tools, MCP servers, plugins and skills are all discovered ' +
      'from this machine at startup — nothing is hard-coded.',
    priority: 'normal',
    position: 0,
    config: { taskPrompt: 'Reply with exactly the word: PONG' },
  });

  return {
    version: BOARD_SCHEMA_VERSION,
    boardTitle: 'Agent Board',
    workspaceRoot,
    columns,
    cards: [welcome],
    chatSessions: [],
    updatedAt: new Date().toISOString(),
  };
}

const PRIORITY_VALUES: Priority[] = ['low', 'normal', 'high', 'urgent'];
const WORKSPACE_MODES: WorkspaceMode[] = ['board', 'dir', 'worktree'];

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function readGoal(raw: unknown): GoalState | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Partial<GoalState>;
  const statuses: GoalState['status'][] = ['running', 'done', 'blocked', 'stopped'];
  if (!g.status || !statuses.includes(g.status)) return null;
  return {
    status: g.status,
    round: typeof g.round === 'number' ? g.round : 0,
    maxRounds: typeof g.maxRounds === 'number' ? g.maxRounds : 0,
    reason: text(g.reason),
    updatedAt: text(g.updatedAt) ?? new Date().toISOString(),
  };
}

/**
 * Bring an arbitrary parsed object up to the current schema.
 *
 * This is defensive on purpose: the board file is user-editable plain JSON, so
 * a hand-edit that drops a field should degrade to a default rather than crash
 * the app on launch.
 */
export function migrate(raw: unknown, workspaceRoot: string | null): BoardState {
  if (!raw || typeof raw !== 'object') return createDefaultBoard(workspaceRoot);
  const obj = raw as Partial<BoardState>;
  if (!Array.isArray(obj.columns) || obj.columns.length === 0) {
    return createDefaultBoard(workspaceRoot);
  }

  const read: Column[] = obj.columns.map((c, i) => ({
    id: c?.id ?? newId(),
    title: c?.title ?? `Column ${i + 1}`,
    position: typeof c?.position === 'number' ? c.position : i,
    wipLimit: typeof c?.wipLimit === 'number' ? c.wipLimit : null,
    accent: c?.accent ?? '#6b7280',
  }));
  // Only a board from before v2 is reshaped. After that the columns are the
  // user's to rename or extend, and a later launch must not undo that.
  const version = typeof obj.version === 'number' ? obj.version : 1;
  const columns = version < 2 ? upgradeColumns(read) : read;

  const columnIds = new Set(columns.map((c) => c.id));
  const fallbackColumnId = [...columns].sort((a, b) => a.position - b.position)[0].id;

  const cards: Card[] = (Array.isArray(obj.cards) ? obj.cards : []).map((c, i) => {
    const now = new Date().toISOString();
    const cfg = (c?.config ?? {}) as Partial<CardAgentConfig>;
    const workingDirectory = cfg.workingDirectory ?? null;
    const workspaceMode: WorkspaceMode =
      cfg.workspaceMode && WORKSPACE_MODES.includes(cfg.workspaceMode)
        ? cfg.workspaceMode
        : workingDirectory
          ? 'dir'
          : 'board';
    return {
      id: c?.id ?? newId(),
      // A card pointing at a deleted column would be invisible forever;
      // reparent it instead of dropping the user's data.
      columnId: c?.columnId && columnIds.has(c.columnId) ? c.columnId : fallbackColumnId,
      title: c?.title ?? 'Untitled card',
      description: c?.description ?? '',
      priority: PRIORITY_VALUES.includes(c?.priority as Priority) ? (c?.priority as Priority) : 'normal',
      labels: Array.isArray(c?.labels) ? c.labels : [],
      position: typeof c?.position === 'number' ? c.position : i,
      config: defaultAgentConfig({
        agentId: cfg.agentId ?? null,
        providerId: cfg.providerId ?? null,
        model: cfg.model ?? null,
        effort: cfg.effort ?? null,
        allowedTools: Array.isArray(cfg.allowedTools) ? cfg.allowedTools : [],
        allowedMcpServers: Array.isArray(cfg.allowedMcpServers) ? cfg.allowedMcpServers : [],
        allowedPlugins: Array.isArray(cfg.allowedPlugins) ? cfg.allowedPlugins : [],
        allowedSkills: Array.isArray(cfg.allowedSkills) ? cfg.allowedSkills : [],
        chatSessionId: cfg.chatSessionId ?? null,
        taskPrompt: cfg.taskPrompt ?? '',
        workspaceMode,
        workingDirectory,
      }),
      lastRunId: c?.lastRunId ?? null,
      runs: Array.isArray(c?.runs) ? c.runs.slice(-MAX_RUNS_PER_CARD) : [],
      createdAt: c?.createdAt ?? now,
      updatedAt: c?.updatedAt ?? now,
      parentId: text(c?.parentId),
      scheduledAt: text(c?.scheduledAt),
      goalMode: c?.goalMode === true,
      goal: readGoal(c?.goal),
      worktreePath: text(c?.worktreePath),
      blockedReason: text(c?.blockedReason),
    };
  });

  // A parent that no longer exists gates nothing; drop the dangling link.
  const cardIds = new Set(cards.map((c) => c.id));
  for (const card of cards) {
    if (card.parentId && (!cardIds.has(card.parentId) || card.parentId === card.id)) card.parentId = null;
  }

  return {
    version: BOARD_SCHEMA_VERSION,
    boardTitle: obj.boardTitle ?? 'Agent Board',
    workspaceRoot: obj.workspaceRoot ?? workspaceRoot,
    columns: columns.sort((a, b) => a.position - b.position),
    cards,
    chatSessions: Array.isArray(obj.chatSessions) ? obj.chatSessions : [],
    updatedAt: obj.updatedAt ?? new Date().toISOString(),
  };
}
