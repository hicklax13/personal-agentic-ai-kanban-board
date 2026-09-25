import { randomUUID } from 'node:crypto';
import type {
  BoardState,
  Card,
  CardAgentConfig,
  Column,
  Priority,
} from '@shared/types';

/**
 * Bump this whenever the on-disk shape changes and add a matching step to
 * `migrate`. Storing the version inside the file (rather than inferring it)
 * means an old board never silently loses fields on first open.
 */
export const BOARD_SCHEMA_VERSION = 1;

/** Keep run history bounded so a long-lived board file stays small and fast. */
export const MAX_RUNS_PER_CARD = 25;

export const newId = (): string => randomUUID();

export function defaultAgentConfig(overrides: Partial<CardAgentConfig> = {}): CardAgentConfig {
  return {
    agentId: null,
    providerId: null,
    model: null,
    allowedTools: [],
    allowedMcpServers: [],
    allowedPlugins: [],
    allowedSkills: [],
    chatSessionId: null,
    taskPrompt: '',
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
  };
}

/**
 * The board a brand-new install opens with. The four columns are the classic
 * flow, and the seeded card doubles as in-app documentation: it tells a first
 * time user exactly where to click.
 */
export function createDefaultBoard(workspaceRoot: string | null): BoardState {
  const backlog = makeColumn('Backlog', 0, '#6b7280');
  const inProgress = makeColumn('In Progress', 1, '#2563eb');
  const inReview = makeColumn('In Review', 2, '#b45309');
  const done = makeColumn('Done', 3, '#15803d');

  const welcome = makeCard({
    columnId: backlog.id,
    title: 'Welcome — open me and press Send to Agent',
    description:
      'Select this card, choose an agent in the right-hand panel, then press ' +
      '"Send to Agent". The reply streams back onto the card. ' +
      'Agents, models, tools, MCP servers, plugins and skills are all discovered ' +
      'from this machine at startup — nothing is hard-coded.',
    priority: 'normal',
    position: 0,
    config: { taskPrompt: 'Reply with exactly the word: PONG' },
  });

  return {
    version: BOARD_SCHEMA_VERSION,
    boardTitle: 'Agent Board',
    workspaceRoot,
    columns: [backlog, inProgress, inReview, done],
    cards: [welcome],
    chatSessions: [],
    updatedAt: new Date().toISOString(),
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

  const columns: Column[] = obj.columns.map((c, i) => ({
    id: c?.id ?? newId(),
    title: c?.title ?? `Column ${i + 1}`,
    position: typeof c?.position === 'number' ? c.position : i,
    wipLimit: typeof c?.wipLimit === 'number' ? c.wipLimit : null,
    accent: c?.accent ?? '#6b7280',
  }));

  const columnIds = new Set(columns.map((c) => c.id));
  const fallbackColumnId = columns[0].id;

  const cards: Card[] = (Array.isArray(obj.cards) ? obj.cards : []).map((c, i) => {
    const now = new Date().toISOString();
    const cfg = (c?.config ?? {}) as Partial<CardAgentConfig>;
    return {
      id: c?.id ?? newId(),
      // A card pointing at a deleted column would be invisible forever;
      // reparent it instead of dropping the user's data.
      columnId: c?.columnId && columnIds.has(c.columnId) ? c.columnId : fallbackColumnId,
      title: c?.title ?? 'Untitled card',
      description: c?.description ?? '',
      priority: (c?.priority ?? 'normal') as Priority,
      labels: Array.isArray(c?.labels) ? c.labels : [],
      position: typeof c?.position === 'number' ? c.position : i,
      config: defaultAgentConfig({
        agentId: cfg.agentId ?? null,
        providerId: cfg.providerId ?? null,
        model: cfg.model ?? null,
        allowedTools: Array.isArray(cfg.allowedTools) ? cfg.allowedTools : [],
        allowedMcpServers: Array.isArray(cfg.allowedMcpServers) ? cfg.allowedMcpServers : [],
        allowedPlugins: Array.isArray(cfg.allowedPlugins) ? cfg.allowedPlugins : [],
        allowedSkills: Array.isArray(cfg.allowedSkills) ? cfg.allowedSkills : [],
        chatSessionId: cfg.chatSessionId ?? null,
        taskPrompt: cfg.taskPrompt ?? '',
        workingDirectory: cfg.workingDirectory ?? null,
      }),
      lastRunId: c?.lastRunId ?? null,
      runs: Array.isArray(c?.runs) ? c.runs.slice(-MAX_RUNS_PER_CARD) : [],
      createdAt: c?.createdAt ?? now,
      updatedAt: c?.updatedAt ?? now,
    };
  });

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
