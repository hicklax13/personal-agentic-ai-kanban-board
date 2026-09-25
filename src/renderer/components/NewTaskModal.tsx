import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type {
  AppSettings,
  BoardState,
  CardAgentConfig,
  DiscoveryReport,
  Priority,
  WorkspaceMode,
} from '@shared/types';
import { PRIORITIES } from '@shared/types';
import { sortedColumns } from '@shared/boardOps';
import { flowKeyOf, isParentDone, parentCandidates, placeNewCard } from '@shared/flow';
import AssigneeFields, { type AssigneeValue } from './AssigneeFields.js';
import ScopeFields, { type ScopeValue } from './ScopeFields.js';
import WorkspaceField from './WorkspaceField.js';
import Toggle from './Toggle.js';
import { buildAssignees, keyForConfig } from './assignees.js';
import { formatWhen, fromLocalInput, toLocalInput } from './time.js';
import { Crest } from './heraldry.js';

export interface TaskDraft {
  title: string;
  description: string;
  priority: Priority;
  config: Partial<CardAgentConfig>;
  parentId: string | null;
  scheduledAt: string | null;
  goalMode: boolean;
}

interface Props {
  board: BoardState;
  /** Where the task starts unless changed here: the column whose "New task" was clicked. */
  columnId: string;
  discovery: DiscoveryReport | null;
  settings: AppSettings;
  onCancel: () => void;
  onCreate: (draft: TaskDraft, columnId: string) => void;
}

const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/**
 * The "New task" popup.
 *
 * Only the title is required. Everything else is optional and has a sensible
 * default: the assignee's saved model and effort, the agent's own tools, the
 * board's folder, no parent, no schedule, one run instead of a Goal loop. The
 * footer says in plain words where the card will go and when it will start, so
 * nothing about READY-starts-by-itself comes as a surprise.
 */
export default function NewTaskModal({
  board,
  columnId: initialColumnId,
  discovery,
  settings,
  onCancel,
  onCreate,
}: Props): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [assignee, setAssignee] = useState<AssigneeValue>({
    agentId: null,
    providerId: null,
    model: null,
    effort: null,
  });
  const [scope, setScope] = useState<ScopeValue>({
    allowedSkills: [],
    allowedMcpServers: [],
    allowedTools: [],
    allowedPlugins: [],
  });
  const [workspace, setWorkspace] = useState<{ mode: WorkspaceMode; path: string | null }>({
    mode: 'board',
    path: null,
  });
  const [parentId, setParentId] = useState<string>('');
  const [scheduleInput, setScheduleInput] = useState('');
  const [goalMode, setGoalMode] = useState(false);
  const [columnId, setColumnId] = useState(initialColumnId);
  const titleRef = useRef<HTMLInputElement>(null);

  // Focus starts in the title and returns to whatever opened the popup.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const columns = sortedColumns(board);
  const columnTitle = (id: string): string => board.columns.find((c) => c.id === id)?.title ?? '';

  const candidates = useMemo(
    () =>
      parentCandidates(board, null).sort(
        (a, b) =>
          columns.findIndex((c) => c.id === a.columnId) - columns.findIndex((c) => c.id === b.columnId) ||
          a.position - b.position,
      ),
    [board, columns],
  );

  const now = new Date();
  const scheduledAt = fromLocalInput(scheduleInput);
  const scheduleInPast = Boolean(scheduledAt && Date.parse(scheduledAt) <= now.getTime());
  const parent = board.cards.find((c) => c.id === parentId);
  const parentOpen = Boolean(parent && !isParentDone(board, { parentId: parentId || null }));

  const target = placeNewCard(board, columnId, { scheduledAt, parentId: parentId || null }, now);
  const targetKey = flowKeyOf(board.columns, target);
  const hasAssignee = Boolean(assignee.agentId);

  const judge = settings.judge;
  const judgeLabel = useMemo(() => {
    if (!judge.agentId) return null;
    const option = buildAssignees(discovery, settings).find(
      (o) => o.key === keyForConfig(judge.agentId, judge.providerId),
    );
    return `${option?.label ?? judge.agentId}${judge.model ? ` · ${judge.model}` : ''}`;
  }, [discovery, settings, judge.agentId, judge.providerId, judge.model]);

  /** Where the card goes and when it starts, in plain words. */
  const outlook = ((): string => {
    const where = `Goes to ${columnTitle(target) || 'the board'}`;
    const needs = hasAssignee ? '' : ' Choose an assignee so it can start.';
    if (targetKey === 'scheduled' && scheduledAt) {
      return `${where} and starts by itself ${formatWhen(scheduledAt, now)}${parentOpen ? `, once "${parent?.title}" is done` : ''}.${needs}`;
    }
    if (targetKey === 'todo' && parentOpen) {
      return `${where} and starts by itself when "${parent?.title}" is in DONE.${needs}`;
    }
    if (targetKey === 'ready') return `${where}, which starts it right away.${needs}`;
    return `${where}. Press Send to Agent on the card, or move it to READY, to run it.`;
  })();

  const canCreate = title.trim() !== '' && !scheduleInPast && !(workspace.mode === 'dir' && !workspace.path);

  const submit = (): void => {
    if (!canCreate) return;
    onCreate({
      title: title.trim(),
      description: description.trim(),
      priority,
      config: {
        ...assignee,
        ...scope,
        workspaceMode: workspace.mode,
        workingDirectory: workspace.mode === 'board' ? null : workspace.path,
      },
      parentId: parentId || null,
      scheduledAt,
      goalMode,
    }, columnId);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal task-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
        }}
      >
        <div className="panel-head">
          <Crest height={30} />
          <h2 id="task-modal-title">New task</h2>
          <span className="spacer" />
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close" title="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="panel-body">
          <div className="field">
            <input
              ref={titleRef}
              id="task-title"
              className="task-title-input"
              value={title}
              placeholder="What should get done? A rough idea is fine"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>

          <div className="field">
            <textarea
              id="task-desc"
              rows={4}
              value={description}
              placeholder="Description (optional) — details, and how to tell when it is done"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="task-grid">
            <div className="field">
              <label htmlFor="task-column">Start in</label>
              <select id="task-column" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <div className="hint">READY starts the task by itself. TODO waits for you.</div>
            </div>
            <div className="field">
              <label htmlFor="task-priority">Priority</label>
              <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
              <div className="hint">Higher priority starts first when several tasks are READY.</div>
            </div>
            <div className="span-2">
              <WorkspaceField
                idPrefix="task"
                mode={workspace.mode}
                path={workspace.path}
                boardFolder={board.workspaceRoot}
                onChange={setWorkspace}
              />
            </div>
          </div>

          <AssigneeFields
            idPrefix="task"
            discovery={discovery}
            settings={settings}
            value={assignee}
            onChange={(next) => {
              // Tools and MCP servers belong to one agent; a new agent starts clean.
              if (next.agentId !== assignee.agentId) {
                setScope({ allowedSkills: [], allowedMcpServers: [], allowedTools: [], allowedPlugins: [] });
              }
              setAssignee(next);
            }}
          />

          <div className="field">
            <label>Skills, MCP servers, tools and plugins (optional)</label>
            <ScopeFields
              discovery={discovery}
              agentId={assignee.agentId}
              value={scope}
              onChange={(patch) => setScope((s) => ({ ...s, ...patch }))}
            />
          </div>

          <div className="field">
            <label htmlFor="task-parent">Parent (blocks until it&apos;s done)</label>
            <select id="task-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— no parent —</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || 'Untitled'} · {columnTitle(c.columnId)}
                </option>
              ))}
            </select>
            {parent ? (
              <div className="hint">
                {parentOpen
                  ? `Waits in TODO until "${parent.title}" reaches DONE.`
                  : `"${parent.title}" is already done, so this does not wait.`}
              </div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="task-schedule">Schedule (optional)</label>
            <div className="row">
              <input
                id="task-schedule"
                type="datetime-local"
                value={scheduleInput}
                min={toLocalInput(now.toISOString())}
                onChange={(e) => setScheduleInput(e.target.value)}
              />
              {scheduleInput ? (
                <button type="button" style={{ flex: '0 0 auto' }} onClick={() => setScheduleInput('')}>
                  Clear
                </button>
              ) : null}
            </div>
            {scheduleInPast ? (
              <div className="hint warn">That time has already passed. Pick a later time, or clear it.</div>
            ) : scheduledAt ? (
              <div className="hint">
                Waits in SCHEDULED, then starts by itself {formatWhen(scheduledAt, now)}. The app has to be
                open then; if it is closed, the task starts the next time you open it.
              </div>
            ) : (
              <div className="hint">Leave empty to start it without waiting.</div>
            )}
          </div>

          <div className="field">
            <Toggle id="task-goal" checked={goalMode} onChange={setGoalMode}>
              Goal mode (worker loops until a judge agrees it&apos;s done)
            </Toggle>
            {goalMode ? (
              judgeLabel ? (
                <div className="hint">
                  Judge: {judgeLabel}, up to {judge.maxRounds} round{judge.maxRounds === 1 ? '' : 's'}. The
                  title and description are what the judge checks, so say what &quot;done&quot; means. Change the
                  judge in Settings → Judge.
                </div>
              ) : (
                <div className="hint warn">
                  No judge is chosen yet. Pick one in Settings → Judge, or this task will stop before it starts.
                </div>
              )
            ) : null}
          </div>
        </div>

        <div className="panel-foot task-foot">
          <span className="task-outlook">{outlook}</span>
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!canCreate} onClick={submit} title="Create task (Ctrl+Enter)">
            Create task
          </button>
        </div>
      </div>
    </div>
  );
}
