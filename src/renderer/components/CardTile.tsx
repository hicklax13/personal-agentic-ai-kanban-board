import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Card, DiscoveredAgent, RunStatus } from '@shared/types';
import type { FlowKey } from '@shared/flow';
import { latestRun } from '@shared/boardOps';
import { formatWhen } from './time.js';

interface Props {
  card: Card;
  agent: DiscoveredAgent | null;
  selected: boolean;
  onSelect: () => void;
  /** The workflow role of the card's column, e.g. 'blocked'. */
  columnKey: FlowKey | null;
  /** Title of the unfinished parent this card waits for, if any. */
  waitingFor: string | null;
}

const STATUS_LABEL: Record<RunStatus, string> = {
  idle: 'idle',
  queued: 'queued',
  acknowledged: 'ack',
  running: 'running',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
};

const ACTIVE: RunStatus[] = ['queued', 'acknowledged', 'running'];

export default function CardTile({
  card,
  agent,
  selected,
  onSelect,
  columnKey,
  waitingFor,
}: Props): React.JSX.Element {
  const drag = useDraggable({ id: card.id, data: { type: 'card', cardId: card.id } });
  // The tile is also a drop target so a card can be inserted at a precise
  // position rather than only appended to the end of a column.
  const drop = useDroppable({ id: `card:${card.id}`, data: { type: 'card', cardId: card.id } });

  const run = latestRun(card);
  const status = run?.status ?? 'idle';
  const active = ACTIVE.includes(status);

  const preview =
    columnKey === 'blocked' && card.blockedReason ? card.blockedReason : (run?.error ?? run?.output ?? '');
  const tail = preview.length > 400 ? `…${preview.slice(-400)}` : preview;

  const goal = card.goal;
  const goalText = !card.goalMode
    ? null
    : goal?.status === 'running'
      ? `goal · round ${goal.round}/${goal.maxRounds}`
      : goal?.status === 'done'
        ? 'goal ✔'
        : goal?.status === 'blocked'
          ? 'goal · needs you'
          : 'goal';

  const classes = [
    'card',
    selected ? 'selected' : '',
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
      style={{ borderLeftColor: selected ? undefined : priorityColour(card.priority) }}
      onClick={onSelect}
      {...drag.listeners}
      {...drag.attributes}
    >
      <div className="card-title">{card.title || 'Untitled'}</div>

      <div className="card-meta">
        {card.priority !== 'normal' ? <span className={`chip pri-${card.priority}`}>{card.priority}</span> : null}

        {card.config.agentId ? (
          <span className="chip" title={agent?.statusDetail ?? 'Agent not found in discovery'}>
            <span className={`dot ${agent?.availability ?? 'unavailable'}`} />
            {agent?.name ?? card.config.agentId}
          </span>
        ) : (
          <span className="chip">no assignee</span>
        )}

        {card.config.model ? <span className="chip">{card.config.model}</span> : null}

        {waitingFor ? (
          <span className="chip flow-wait" title="Starts when its parent reaches DONE">
            waits for: {waitingFor}
          </span>
        ) : null}

        {card.scheduledAt && columnKey === 'scheduled' ? (
          <span className="chip flow-sched" title={new Date(card.scheduledAt).toLocaleString()}>
            starts {formatWhen(card.scheduledAt)}
          </span>
        ) : null}

        {goalText ? (
          <span className={`chip flow-goal ${goal?.status === 'running' ? 'pulsing' : ''}`} title={goal?.reason ?? undefined}>
            {goalText}
          </span>
        ) : null}

        {card.config.workspaceMode === 'worktree' ? (
          <span className="chip" title={card.worktreePath ?? 'A git worktree is made on the first run'}>
            worktree
          </span>
        ) : null}

        {status !== 'idle' ? (
          <span className={`chip st-${status} ${active ? 'pulsing' : ''}`}>
            {run?.role === 'judge' ? 'judge ' : ''}
            {STATUS_LABEL[status]}
          </span>
        ) : null}
      </div>

      {tail ? <div className={`card-output ${columnKey === 'blocked' ? 'blocked' : ''}`}>{tail}</div> : null}
    </div>
  );
}

function priorityColour(priority: Card['priority']): string {
  switch (priority) {
    case 'urgent':
      return '#f85149';
    case 'high':
      return '#d29922';
    case 'low':
      return '#3d5a75';
    default:
      return '#3a4250';
  }
}
