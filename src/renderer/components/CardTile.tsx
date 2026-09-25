import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Card, DiscoveredAgent, RunStatus } from '@shared/types';
import { latestRun } from '@shared/boardOps';

interface Props {
  card: Card;
  agent: DiscoveredAgent | null;
  selected: boolean;
  onSelect: () => void;
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

export default function CardTile({ card, agent, selected, onSelect }: Props): React.JSX.Element {
  const drag = useDraggable({ id: card.id, data: { type: 'card', cardId: card.id } });
  // The tile is also a drop target so a card can be inserted at a precise
  // position rather than only appended to the end of a column.
  const drop = useDroppable({ id: `card:${card.id}`, data: { type: 'card', cardId: card.id } });

  const run = latestRun(card);
  const status = run?.status ?? 'idle';
  const active = ACTIVE.includes(status);

  const preview = run?.error ?? run?.output ?? '';
  const tail = preview.length > 400 ? `…${preview.slice(-400)}` : preview;

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
        {card.priority !== 'normal' ? (
          <span className={`chip pri-${card.priority}`}>{card.priority}</span>
        ) : null}

        {card.config.agentId ? (
          <span className="chip" title={agent?.statusDetail ?? 'Agent not found in discovery'}>
            <span className={`dot ${agent?.availability ?? 'unavailable'}`} />
            {agent?.name ?? card.config.agentId}
          </span>
        ) : (
          <span className="chip">no agent</span>
        )}

        {card.config.model ? <span className="chip">{card.config.model}</span> : null}

        {status !== 'idle' ? (
          <span className={`chip st-${status} ${active ? 'pulsing' : ''}`}>
            {STATUS_LABEL[status]}
          </span>
        ) : null}
      </div>

      {tail ? <div className="card-output">{tail}</div> : null}
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
