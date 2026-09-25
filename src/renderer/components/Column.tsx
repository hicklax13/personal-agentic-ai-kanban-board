import { useDroppable } from '@dnd-kit/core';
import type { BoardState, Card, Column as ColumnModel, DiscoveredAgent } from '@shared/types';
import { flowKeyOf, isParentDone, parentOf } from '@shared/flow';
import CardTile from './CardTile.js';

interface Props {
  board: BoardState;
  column: ColumnModel;
  cards: Card[];
  agentsById: Map<string, DiscoveredAgent>;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  onAddCard: (columnId: string) => void;
  onRenameColumn: (columnId: string, title: string) => void;
  onDeleteColumn: (columnId: string) => void;
  canDelete: boolean;
}

export default function Column({
  board,
  column,
  cards,
  agentsById,
  selectedCardId,
  onSelectCard,
  onAddCard,
  onRenameColumn,
  onDeleteColumn,
  canDelete,
}: Props): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.id}`,
    data: { type: 'column', columnId: column.id },
  });

  const overWip = column.wipLimit !== null && cards.length > column.wipLimit;
  const columnKey = flowKeyOf(board.columns, column.id);

  return (
    <div className={`column ${isOver ? 'drop-target' : ''}`}>
      <div className="column-head">
        <span className="column-dot" style={{ background: column.accent }} />
        <input
          className="column-title"
          value={column.title}
          onChange={(e) => onRenameColumn(column.id, e.target.value)}
          aria-label="Column title"
        />
        <span
          className={`column-count ${overWip ? 'over-wip' : ''}`}
          title={column.wipLimit !== null ? `WIP limit ${column.wipLimit}` : undefined}
        >
          {cards.length}
          {column.wipLimit !== null ? ` / ${column.wipLimit}` : ''}
        </span>
        {canDelete ? (
          <button
            type="button"
            className="ghost"
            title="Delete column (cards move to the first column)"
            onClick={() => onDeleteColumn(column.id)}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div className="column-body" ref={setNodeRef}>
        {cards.map((card) => (
          <CardTile
            key={card.id}
            card={card}
            agent={card.config.agentId ? (agentsById.get(card.config.agentId) ?? null) : null}
            selected={card.id === selectedCardId}
            onSelect={() => onSelectCard(card.id)}
            columnKey={columnKey}
            waitingFor={isParentDone(board, card) ? null : (parentOf(board, card)?.title ?? null)}
          />
        ))}
        {cards.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px 8px', fontSize: 11.5 }}>
            Drop a card here
          </div>
        ) : null}
      </div>

      <div className="column-foot">
        <button type="button" className="ghost" onClick={() => onAddCard(column.id)}>
          + New task
        </button>
      </div>
    </div>
  );
}
