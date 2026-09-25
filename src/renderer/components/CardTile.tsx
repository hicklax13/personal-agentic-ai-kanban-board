import { useEffect, useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { ArrowRight, CalendarClock, Check, CircleCheck, GitBranch, Link2, RotateCcw, Target, UserRound } from 'lucide-react';
import type { AgentRun, Card, DiscoveredAgent, RunStatus } from '@shared/types';
import type { FlowKey } from '@shared/flow';
import { latestRun } from '@shared/boardOps';
import { AGENT_ARMS, Escutcheon } from './heraldry.js';
import type { NextStop } from './nextStop.js';
import { formatWhen } from './time.js';

const ACTIVE: RunStatus[] = ['queued', 'acknowledged', 'running'];

const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', low: 'Low' } as const;

interface FaceProps {
  card: Card;
  agent: DiscoveredAgent | null;
  /** The workflow role of the card's column, e.g. 'blocked'. */
  columnKey: FlowKey | null;
  /** Title of the unfinished parent this card waits for, if any. */
  waitingFor: string | null;
  stop: NextStop;
  /** Quick moves: Retry sends a BLOCKED card back to READY, Approve a REVIEW card on to DONE. */
  onMove?: (to: FlowKey) => void;
}

/** A one-second clock that only ticks while a run is live. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function elapsed(fromIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** What a live run is doing: its newest event, else its newest line of output. */
function activityOf(run: AgentRun): string {
  const event = run.events[run.events.length - 1]?.text.trim();
  if (event) return event;
  const line = run.output.trim().split('\n').pop()?.trim();
  if (line) return line;
  return run.role === 'judge' ? 'The judge is checking the work…' : 'Starting…';
}

/** A chip for run states the rest of the card does not already say. */
function statusChip(status: RunStatus, columnKey: FlowKey | null): { label: string; cls: string } | null {
  switch (status) {
    case 'queued':
      return { label: 'Queued', cls: 'st-queued' };
    case 'acknowledged':
      return { label: 'Starting', cls: 'st-acknowledged' };
    case 'failed':
      return columnKey === 'blocked' ? null : { label: 'Last run failed', cls: 'st-failed' };
    case 'cancelled':
      return { label: 'Last run cancelled', cls: 'st-cancelled' };
    case 'succeeded':
      return columnKey === 'review' || columnKey === 'done' ? null : { label: 'Last run finished', cls: 'st-succeeded' };
    default:
      return null;
  }
}

function goalLabel(card: Card): string | null {
  if (!card.goalMode) return null;
  const goal = card.goal;
  switch (goal?.status) {
    case 'running':
      return `Goal · round ${goal.round} of ${goal.maxRounds}`;
    case 'done':
      return 'Goal met';
    case 'blocked':
      return 'Goal needs you';
    case 'stopped':
      return 'Goal stopped';
    default:
      return 'Goal mode';
  }
}

/** Buttons inside a draggable card must not start a drag or select the card. */
const inCard = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
};

/**
 * What a card shows: its arms, title, who runs it on what, its live state, and
 * its next stop. Shared by the tile on the board and the copy under the cursor
 * while it is dragged.
 */
export function CardFace({ card, agent, columnKey, waitingFor, stop, onMove }: FaceProps): React.JSX.Element {
  const run = latestRun(card);
  const status = run?.status ?? 'idle';
  const live = ACTIVE.includes(status);
  const now = useNow(live);

  const agentName = agent?.name ?? (card.config.agentId ? AGENT_ARMS[card.config.agentId]?.name : null) ?? card.config.agentId;
  // In TODO the next stop already names the parent it waits for.
  const waits = columnKey === 'todo' ? null : waitingFor;
  const blocked = columnKey === 'blocked';
  const review = columnKey === 'review';
  const done = columnKey === 'done';
  const chip = statusChip(status, columnKey);
  const goal = goalLabel(card);
  const reason = blocked ? (card.blockedReason ?? run?.error ?? null) : null;
  const result = review && run?.output ? run.output.trim().split('\n').filter(Boolean).slice(-3).join('\n') : '';

  const move = (to: FlowKey) => (e: React.MouseEvent): void => {
    e.stopPropagation();
    onMove?.(to);
  };

  return (
    <>
      {blocked ? <div className="hatch-band" aria-hidden="true" /> : null}

      <div className="card-head">
        <Escutcheon agentId={card.config.agentId} priority={card.priority} muted={done} />
        <div className="card-title">{card.title || 'Untitled'}</div>
      </div>

      <div className="card-meta">
        {card.config.agentId ? (
          <>
            <div className="meta-agent">
              {agent && agent.availability !== 'available' ? (
                <span className={`dot ${agent.availability}`} title={agent.statusDetail} />
              ) : null}
              {agentName}
            </div>
            <div className="meta-model" title={`${card.config.model ?? 'default model'}${card.config.effort ? ` · ${card.config.effort}` : ''}`}>
              {card.config.model ?? 'default model'}
              {card.config.effort ? ` · ${card.config.effort}` : ''}
            </div>
          </>
        ) : (
          <div className="meta-agent">No one assigned yet</div>
        )}
      </div>

      {card.priority !== 'normal' || waits || goal || chip || card.config.workspaceMode === 'worktree' || (card.scheduledAt && columnKey === 'scheduled') ? (
        <div className="card-chips">
          {card.priority !== 'normal' ? (
            <span className={`chip pri-${card.priority}`}>{PRIORITY_LABEL[card.priority]}</span>
          ) : null}
          {waits ? (
            <span className="chip wait" title="Starts when its parent reaches DONE">
              <Link2 size={12} aria-hidden="true" />
              Waits for “{waits}”
            </span>
          ) : null}
          {card.scheduledAt && columnKey === 'scheduled' ? (
            <span className="chip sched" title={new Date(card.scheduledAt).toLocaleString()}>
              <CalendarClock size={12} aria-hidden="true" />
              {formatWhen(card.scheduledAt)}
            </span>
          ) : null}
          {goal ? (
            <span className={`chip goal${card.goal?.status === 'done' ? ' done' : ''}`} title={card.goal?.reason ?? undefined}>
              <Target size={12} aria-hidden="true" />
              {goal}
            </span>
          ) : null}
          {card.config.workspaceMode === 'worktree' ? (
            <span className="chip" title={card.worktreePath ?? 'A git worktree is made on the first run'}>
              <GitBranch size={12} aria-hidden="true" />
              Worktree
            </span>
          ) : null}
          {chip ? <span className={`chip ${chip.cls}`}>{chip.label}</span> : null}
        </div>
      ) : null}

      {live && run ? (
        <div className="card-live-block">
          <div className="card-live">
            <span className="live-dot" aria-hidden="true" />
            <span className="live-time">{elapsed(run.startedAt, now)}</span>
            <span className="live-role">
              {run.role === 'judge' ? 'judge checking' : status === 'running' ? 'working' : 'starting'}
              {run.round ? ` · round ${run.round}` : ''}
            </span>
          </div>
          <div className="live-activity" title={activityOf(run)}>
            {activityOf(run)}
          </div>
          {/* Still between updates; keyed on the output so it flashes once each time more arrives. */}
          <div className="live-track" key={`${run.events.length}:${run.output.length}`} aria-hidden="true" />
        </div>
      ) : card.goal?.status === 'running' ? (
        <div className="card-live">
          <span className="live-dot" aria-hidden="true" />
          <span className="live-activity">Between rounds — the next one starts shortly</span>
        </div>
      ) : null}

      {reason ? (
        <div className="card-reason">
          <span>{reason}</span>
        </div>
      ) : null}
      {result ? (
        <div className="card-output">
          <span>{result}</span>
        </div>
      ) : null}

      {(review || done) && run?.endedAt ? (
        <div className="card-finished">
          <CircleCheck size={14} aria-hidden="true" />
          Finished {formatWhen(run.endedAt)}
        </div>
      ) : null}

      {onMove && (blocked || review) ? (
        <div className="card-actions">
          {blocked ? (
            <button type="button" className="small" {...inCard} onClick={move('ready')} title="Move to READY; it starts again by itself">
              <RotateCcw size={14} aria-hidden="true" />
              Retry
            </button>
          ) : (
            <button type="button" className="small approve" {...inCard} onClick={move('done')} title="Accept the work and move it to DONE">
              <Check size={14} aria-hidden="true" />
              Approve
            </button>
          )}
        </div>
      ) : null}

      {stop.text ? (
        <div className={`next-stop${stop.needsYou ? ' needs-you' : ''}`}>
          {stop.needsYou ? <UserRound size={15} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
          <span>
            <span className="sr-only">{stop.needsYou ? 'Next stop, waiting for you: ' : 'Next stop: '}</span>
            {stop.text}
          </span>
        </div>
      ) : null}
    </>
  );
}

/** The card's look for its column: live, stuck, awaiting review, finished, or a raw idea. */
export function cardStateClass(columnKey: FlowKey | null): string {
  switch (columnKey) {
    case 'triage':
      return 'is-idea';
    case 'running':
      return 'is-running';
    case 'blocked':
      return 'is-blocked';
    case 'review':
      return 'is-review';
    case 'done':
      return 'is-done';
    default:
      return '';
  }
}

interface Props extends FaceProps {
  selected: boolean;
  /** The selected card's parent or child. */
  related: boolean;
  /** Left out by the search box: shown faintly so the board keeps its shape. */
  dimmed: boolean;
  onSelect: () => void;
}

export default function CardTile({ selected, related, dimmed, onSelect, ...face }: Props): React.JSX.Element {
  const { card, columnKey } = face;
  const drag = useDraggable({ id: card.id, data: { type: 'card', cardId: card.id } });
  // The tile is also a drop target so a card can be inserted at a precise
  // position rather than only appended to the end of a column.
  const drop = useDroppable({ id: `card:${card.id}`, data: { type: 'card', cardId: card.id } });

  const classes = [
    'card',
    cardStateClass(columnKey),
    selected ? 'selected' : '',
    related && !selected ? 'related' : '',
    dimmed ? 'dimmed' : '',
    drag.isDragging ? 'dragging' : '',
    drop.isOver && !drag.isDragging ? 'drop-before' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      className={classes}
      data-card-id={card.id}
      onClick={onSelect}
      {...drag.listeners}
      {...drag.attributes}
      onKeyDown={(e) => {
        // Enter opens the card; Space picks it up to move with the arrow keys.
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          onSelect();
          return;
        }
        drag.listeners?.onKeyDown?.(e);
      }}
    >
      <CardFace {...face} />
    </div>
  );
}
