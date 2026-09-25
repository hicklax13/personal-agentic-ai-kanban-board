import { useEffect, useMemo, useState } from 'react';
import { Check, Play, RotateCcw, Square, Trash, X } from 'lucide-react';
import type {
  AgentRun,
  AppSettings,
  BoardState,
  Card,
  CardAgentConfig,
  ChatSession,
  DiscoveryReport,
  Priority,
} from '@shared/types';
import { PRIORITIES } from '@shared/types';
import { latestRun, sortedColumns } from '@shared/boardOps';
import { type FlowKey, flowKeyOf, isParentDone, parentCandidates } from '@shared/flow';
import AssigneeFields from './AssigneeFields.js';
import ScopeFields from './ScopeFields.js';
import WorkspaceField from './WorkspaceField.js';
import Toggle from './Toggle.js';
import { formatWhen, fromLocalInput, toLocalInput } from './time.js';
import { Escutcheon } from './heraldry.js';

interface Props {
  card: Card;
  board: BoardState;
  discovery: DiscoveryReport | null;
  settings: AppSettings;
  chatSessions: ChatSession[];
  isRunning: boolean;
  /** Where agents run when this card sets no folder of its own. */
  workspaceRoot: string | null;
  onPatchCard: (patch: Partial<Omit<Card, 'id' | 'config' | 'runs'>>) => void;
  onPatchConfig: (patch: Partial<CardAgentConfig>) => void;
  /** Setting or clearing a schedule can also move the card in or out of SCHEDULED. */
  onSetSchedule: (scheduledAt: string | null) => void;
  /** Retry (BLOCKED → READY) and Approve (REVIEW → DONE), as on the card. */
  onMove: (to: FlowKey) => void;
  onDelete: () => void;
  onDispatch: () => void;
  onCancel: () => void;
  onCreateChatSession: (name: string) => string;
  onClose: () => void;
}

function runLabel(run: AgentRun): string {
  const who = run.role === 'judge' ? 'Judge' : 'Worker';
  return run.round ? `${who}, round ${run.round}` : who;
}

/**
 * The per-card panel: everything the New Task popup sets, editable later, plus
 * the card's runs.
 *
 * Its guiding rule is that a control never lies about what it does: scoping
 * lists say whether the agent's CLI enforces them, and blank model and effort
 * fields say which default they will use.
 */
export default function CardDetail({
  card,
  board,
  discovery,
  settings,
  chatSessions,
  isRunning,
  workspaceRoot,
  onPatchCard,
  onPatchConfig,
  onSetSchedule,
  onMove,
  onDelete,
  onDispatch,
  onCancel,
  onCreateChatSession,
  onClose,
}: Props): React.JSX.Element {
  const [showTranscript, setShowTranscript] = useState(false);
  const [newSession, setNewSession] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A question asked about one card must not carry over to the next.
  useEffect(() => setConfirmDelete(false), [card.id]);

  const columns = sortedColumns(board);
  const columnTitle = (id: string): string => board.columns.find((c) => c.id === id)?.title ?? '';
  const key = flowKeyOf(board.columns, card.columnId);

  const candidates = useMemo(
    () =>
      parentCandidates(board, card.id).sort(
        (a, b) =>
          columns.findIndex((c) => c.id === a.columnId) - columns.findIndex((c) => c.id === b.columnId) ||
          a.position - b.position,
      ),
    [board, card.id, columns],
  );
  const parent = board.cards.find((c) => c.id === card.parentId);
  const waiting = Boolean(parent && !isParentDone(board, card));

  const run = latestRun(card);
  const goalRuns = card.runs.filter((r) => r.role);
  const canDispatch = Boolean(card.config.agentId) && !isRunning;
  const scheduleInPast = Boolean(card.scheduledAt && Date.parse(card.scheduledAt) <= Date.now());

  return (
    <aside className="panel" aria-label="Task details">
      <div className="panel-head">
        <Escutcheon agentId={card.config.agentId} priority={card.priority} />
        <h2>Task</h2>
        <span className="chip station-chip">{columnTitle(card.columnId)}</span>
        <span className="spacer" />
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close the panel" title="Close the panel">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="panel-body">
        {key === 'blocked' && card.blockedReason ? (
          <div className="banner err">
            <b>Blocked:</b> {card.blockedReason}
          </div>
        ) : null}

        {/* ------------------------------------------------------- basics */}
        <div className="field">
          <label htmlFor="card-title">Title</label>
          <input id="card-title" value={card.title} onChange={(e) => onPatchCard({ title: e.target.value })} />
        </div>

        <div className="field">
          <label htmlFor="card-desc">Description</label>
          <textarea
            id="card-desc"
            rows={3}
            value={card.description}
            onChange={(e) => onPatchCard({ description: e.target.value })}
            placeholder="Details the agent should know, and how to tell when it is done."
          />
        </div>

        <div className="field row">
          <div>
            <label htmlFor="card-pri">Priority</label>
            <select
              id="card-pri"
              value={card.priority}
              onChange={(e) => onPatchCard({ priority: e.target.value as Priority })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="card-session">Chat session</label>
            {newSession === null ? (
              <select
                id="card-session"
                value={card.config.chatSessionId ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    setNewSession('');
                    return;
                  }
                  onPatchConfig({ chatSessionId: e.target.value || null });
                }}
              >
                <option value="">(one-off — no shared thread)</option>
                {chatSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.nativeSessionId ? ' ·  resumable' : ''}
                  </option>
                ))}
                <option value="__new__">Add a new session…</option>
              </select>
            ) : (
              <div className="row">
                <input
                  id="card-session"
                  autoFocus
                  value={newSession}
                  placeholder="Name the session"
                  onChange={(e) => setNewSession(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setNewSession(null);
                    if (e.key === 'Enter' && newSession.trim()) {
                      onPatchConfig({ chatSessionId: onCreateChatSession(newSession.trim()) });
                      setNewSession(null);
                    }
                  }}
                />
                <button
                  type="button"
                  style={{ flex: '0 0 auto' }}
                  disabled={!newSession.trim()}
                  onClick={() => {
                    onPatchConfig({ chatSessionId: onCreateChatSession(newSession.trim()) });
                    setNewSession(null);
                  }}
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------- who */}
        <fieldset className="group">
          <legend>Who does it</legend>
          <AssigneeFields
            idPrefix="card"
            discovery={discovery}
            settings={settings}
            value={card.config}
            onChange={(next) =>
              onPatchConfig(
                next.agentId !== card.config.agentId
                  ? // Tools and MCP servers belong to one agent; a new agent starts clean.
                    { ...next, allowedTools: [], allowedMcpServers: [], allowedPlugins: [], allowedSkills: [] }
                  : next,
              )
            }
          />
          <div className="field-note">Defaults for each provider are set in Settings.</div>
        </fieldset>

        {/* -------------------------------------------------- workflow */}
        <fieldset className="group">
          <legend>When it runs</legend>

          <div className="field">
            <label htmlFor="card-parent">Parent (blocks until it&apos;s done)</label>
            <select
              id="card-parent"
              value={card.parentId ?? ''}
              onChange={(e) => onPatchCard({ parentId: e.target.value || null })}
            >
              <option value="">— no parent —</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || 'Untitled'} · {columnTitle(c.columnId)}
                </option>
              ))}
            </select>
            {parent ? (
              <div className="hint">
                {waiting
                  ? `Waits in TODO until "${parent.title}" is in DONE, then moves to READY and starts.`
                  : `"${parent.title}" is done, so nothing holds this back.`}
              </div>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="card-schedule">Schedule</label>
            <div className="row">
              <input
                id="card-schedule"
                type="datetime-local"
                value={toLocalInput(card.scheduledAt)}
                onChange={(e) => onSetSchedule(fromLocalInput(e.target.value))}
              />
              {card.scheduledAt ? (
                <button type="button" style={{ flex: '0 0 auto' }} onClick={() => onSetSchedule(null)}>
                  Clear
                </button>
              ) : null}
            </div>
            {card.scheduledAt ? (
              <div className="hint">
                {key === 'scheduled'
                  ? scheduleInPast
                    ? 'Due now — it moves to READY within a few seconds.'
                    : `Starts by itself ${formatWhen(card.scheduledAt)}.`
                  : `Scheduled for ${formatWhen(card.scheduledAt)}. It only waits while it is in SCHEDULED.`}
              </div>
            ) : null}
          </div>

          <div className="field">
            <Toggle id="card-goal" checked={card.goalMode} onChange={(goalMode) => onPatchCard({ goalMode })}>
              Goal mode (worker loops until a judge agrees it&apos;s done)
            </Toggle>
            {card.goalMode && !settings.judge.agentId ? (
              <div className="hint warn">No judge is chosen yet — pick one in Settings → Judge.</div>
            ) : null}
            {card.goal ? (
              <div className={`goal-status goal-${card.goal.status}`}>
                <b>
                  Goal {card.goal.status}
                  {card.goal.maxRounds ? ` · round ${card.goal.round} of ${card.goal.maxRounds}` : ''}
                </b>
                {card.goal.reason ? <div>{card.goal.reason}</div> : null}
              </div>
            ) : null}
          </div>
        </fieldset>

        {/* ------------------------------------------------------ where */}
        <WorkspaceField
          idPrefix="card"
          mode={card.config.workspaceMode}
          path={card.config.workingDirectory}
          boardFolder={workspaceRoot}
          onChange={({ mode, path }) => onPatchConfig({ workspaceMode: mode, workingDirectory: path })}
        />
        {card.worktreePath ? (
          <div className="field-note" style={{ marginTop: -6, marginBottom: 12 }}>
            This card&apos;s worktree: <code className="inline">{card.worktreePath}</code>
          </div>
        ) : null}

        {/* ------------------------------------------------------ scope */}
        <div className="field">
          <label>Skills, MCP servers, tools and plugins</label>
          <ScopeFields
            discovery={discovery}
            agentId={card.config.agentId}
            value={card.config}
            onChange={(patch) => onPatchConfig(patch)}
          />
        </div>

        {/* ------------------------------------------------------- prompt */}
        <div className="field">
          <label htmlFor="card-prompt">Task prompt</label>
          <textarea
            id="card-prompt"
            rows={5}
            value={card.config.taskPrompt}
            onChange={(e) => onPatchConfig({ taskPrompt: e.target.value })}
            placeholder="The instruction sent to the agent. Empty uses the title, with the description as context."
          />
        </div>

        {/* ------------------------------------------------------- rounds */}
        {card.goalMode && goalRuns.length > 0 ? (
          <fieldset className="group">
            <legend>Goal rounds</legend>
            <div className="rounds">
              {goalRuns.map((r) => (
                <div key={r.id} className="round-row">
                  <span className={`chip st-${r.status}`}>{runLabel(r)}</span>
                  <span className="round-text">
                    {r.verdict
                      ? `${r.verdict.verdict}${r.verdict.reason ? ` — ${r.verdict.reason}` : ''}`
                      : (r.error ?? r.status)}
                  </span>
                </div>
              ))}
            </div>
          </fieldset>
        ) : null}

        {/* ------------------------------------------------------- result */}
        {run ? (
          <fieldset className="group">
            <legend>
              Last run — {run.role ? `${runLabel(run)} · ` : ''}
              {run.status}
            </legend>

            {run.error ? <div className="banner err">{run.error}</div> : null}
            {run.verdict ? (
              <div className={`banner ${run.verdict.verdict === 'done' ? 'info' : 'warn'}`}>
                Judge: <b>{run.verdict.verdict}</b>
                {run.verdict.reason ? ` — ${run.verdict.reason}` : ''}
              </div>
            ) : null}

            {run.command ? (
              <div className="field">
                <label>Command</label>
                <div className="transcript" style={{ maxHeight: 90 }}>
                  {run.command}
                </div>
              </div>
            ) : null}

            <div className="field">
              <label>Output</label>
              <div className="transcript">
                {run.output || (run.status === 'running' ? 'Waiting for output…' : '(empty)')}
              </div>
            </div>

            <button type="button" className="ghost" onClick={() => setShowTranscript((v) => !v)}>
              {showTranscript ? 'Hide' : 'Show'} event log ({run.events.length})
            </button>

            {showTranscript ? (
              <div className="transcript" style={{ marginTop: 6 }}>
                {run.events.length === 0
                  ? '(no events)'
                  : run.events.map((e, i) => (
                      <div key={i} className={`ev-${e.kind}`}>
                        [{e.kind}] {e.text}
                      </div>
                    ))}
              </div>
            ) : null}

            {run.agentSessionId ? (
              <div className="hint">
                Agent session: <code className="inline">{run.agentSessionId}</code>
              </div>
            ) : null}
          </fieldset>
        ) : null}
      </div>

      <div className="panel-foot">
        {key === 'review' && !isRunning ? (
          <button type="button" className="approve" onClick={() => onMove('done')} title="Accept the work and move it to DONE">
            <Check size={16} aria-hidden="true" />
            Approve
          </button>
        ) : null}
        {key === 'blocked' && !isRunning ? (
          <button type="button" onClick={() => onMove('ready')} title="Move to READY; it starts again by itself">
            <RotateCcw size={16} aria-hidden="true" />
            Retry
          </button>
        ) : null}
        {isRunning ? (
          <button type="button" className="danger" onClick={onCancel}>
            <Square size={14} aria-hidden="true" />
            {card.goal?.status === 'running' ? 'Stop goal' : 'Cancel run'}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={onDispatch}
            disabled={!canDispatch}
            title={
              !card.config.agentId
                ? 'Choose who does this task first'
                : waiting
                  ? 'Waits for its parent, then starts by itself'
                  : 'Run this card now'
            }
          >
            <Play size={15} aria-hidden="true" />
            {waiting ? 'Send when parent is done' : 'Send to Agent'}
          </button>
        )}
        <span className="spacer" />
        {confirmDelete ? (
          <div className="inline-confirm" role="alert">
            <span>Delete this card and its run history?</span>
            <button type="button" className="danger solid" onClick={onDelete}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} autoFocus>
              Keep
            </button>
          </div>
        ) : (
          <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>
            <Trash size={15} aria-hidden="true" />
            Delete card
          </button>
        )}
      </div>
    </aside>
  );
}
