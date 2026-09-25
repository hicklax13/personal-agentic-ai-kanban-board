import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { BoardState, DiscoveredAgent } from '@shared/types';
import { cardsInColumn, sortedColumns } from '@shared/boardOps';
import Column from './Column.js';

interface Props {
  board: BoardState;
  agentsById: Map<string, DiscoveredAgent>;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  onMoveCard: (cardId: string, columnId: string, index: number) => void;
  onAddCard: (columnId: string) => void;
  onAddColumn: () => void;
  onRenameColumn: (columnId: string, title: string) => void;
  onDeleteColumn: (columnId: string) => void;
}

export default function Board({
  board,
  agentsById,
  selectedCardId,
  onSelectCard,
  onMoveCard,
  onAddCard,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
}: Props): React.JSX.Element {
  // An 6px activation distance means a click to select a card is not mistaken
  // for the start of a drag — without it, selecting a card is oddly hard.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const columns = sortedColumns(board);

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over) return;

    const cardId = String(active.id);
    const overData = over.data.current as
      | { type: 'column'; columnId: string }
      | { type: 'card'; cardId: string }
      | undefined;
    if (!overData) return;

    if (overData.type === 'column') {
      // Dropped on empty column space: append.
      const target = cardsInColumn(board, overData.columnId).filter((c) => c.id !== cardId);
      onMoveCard(cardId, overData.columnId, target.length);
      return;
    }

    // Dropped on another card: take that card's slot.
    const targetCard = board.cards.find((c) => c.id === overData.cardId);
    if (!targetCard || targetCard.id === cardId) return;
    const siblings = cardsInColumn(board, targetCard.columnId).filter((c) => c.id !== cardId);
    const index = siblings.findIndex((c) => c.id === targetCard.id);
    onMoveCard(cardId, targetCard.columnId, index < 0 ? siblings.length : index);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="board">
        {columns.map((column) => (
          <Column
            key={column.id}
            column={column}
            cards={cardsInColumn(board, column.id)}
            agentsById={agentsById}
            selectedCardId={selectedCardId}
            onSelectCard={onSelectCard}
            onAddCard={onAddCard}
            onRenameColumn={onRenameColumn}
            onDeleteColumn={onDeleteColumn}
            canDelete={columns.length > 1}
          />
        ))}
        <div style={{ flexShrink: 0 }}>
          <button type="button" onClick={onAddColumn}>
            + Add column
          </button>
        </div>
      </div>
    </DndContext>
  );
}
