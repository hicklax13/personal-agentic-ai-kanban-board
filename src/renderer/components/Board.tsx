import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type Over,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import type { BoardState, DiscoveredAgent } from '@shared/types';
import { cardsInColumn, sortedColumns } from '@shared/boardOps';
import { type FlowKey, flowColumn, flowKeyOf, isParentDone, parentOf } from '@shared/flow';
import Column, { type StationTrace } from './Column.js';
import { CardFace, cardStateClass } from './CardTile.js';
import { nextStop } from './nextStop.js';
import { cardMatches, searchWords } from './search.js';
import { planStations } from './stationLayout.js';

interface Props {
  board: BoardState;
  agentsById: Map<string, DiscoveredAgent>;
  selectedCardId: string | null;
  /** The search box; cards that do not match are shown faintly. */
  query: string;
  /** A station to point out for a moment, after a click on the status line. */
  flashKey: FlowKey | null;
  onSelectCard: (id: string) => void;
  onMoveCard: (cardId: string, columnId: string, index: number) => void;
  onQuickMove: (cardId: string, to: FlowKey) => void;
  onAddCard: (columnId: string) => void;
  onAddColumn: () => void;
  onRenameColumn: (columnId: string, title: string) => void;
  onDeleteColumn: (columnId: string) => void;
}

const NO_TRACE: StationTrace = { here: false, next: false, left: false, right: false };

/**
 * A card lands where the pointer is: on the card under it (taking that card's
 * place) or else in the station under it. Stations run the full height of the
 * board, so measuring by nearest corners would favour a card in the next
 * station over the empty station the pointer is in. Keyboard moves have no
 * pointer and keep the nearest-corner rule.
 */
const dropUnderPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length === 0) return closestCorners(args);
  const card = hits.find((hit) => String(hit.id).startsWith('card:'));
  return card ? [card] : hits;
};

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Board({
  board,
  agentsById,
  selectedCardId,
  query,
  flashKey,
  onSelectCard,
  onMoveCard,
  onQuickMove,
  onAddCard,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
}: Props): React.JSX.Element {
  // A 6px activation distance means a click to select a card is not mistaken
  // for the start of a drag. From the keyboard, Space picks a card up so Enter
  // stays free to open it.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /** The owner's own fold or unfold, per station; otherwise the width decides. */
  const [foldChoice, setFoldChoice] = useState<Record<string, boolean>>({});
  const boardEl = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(Number.POSITIVE_INFINITY);

  useEffect(() => {
    const el = boardEl.current;
    if (!el) return;
    const measure = (): void => setBoardWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Opening the panel narrows the board; keep the chosen card in sight.
  useEffect(() => {
    if (!selectedCardId) return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector(`[data-card-id="${CSS.escape(selectedCardId)}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedCardId]);

  const columns = sortedColumns(board);
  const agentName = (agentId: string | null): string => (agentId ? (agentsById.get(agentId)?.name ?? agentId) : '');

  // ---------------------------------------------------------- the trace
  // The selected card's station, its next stop, and the rail between them.
  const selected = selectedCardId ? board.cards.find((c) => c.id === selectedCardId) : undefined;
  const hereAt = selected ? columns.findIndex((c) => c.id === selected.columnId) : -1;
  const stop = selected ? nextStop(board, selected) : null;
  const nextColumn = stop?.to ? flowColumn(board.columns, stop.to) : undefined;
  const nextAt = nextColumn ? columns.findIndex((c) => c.id === nextColumn.id) : -1;
  const lo = Math.min(hereAt, nextAt);
  const hi = Math.max(hereAt, nextAt);
  const traced = hereAt >= 0 && nextAt >= 0 && hereAt !== nextAt;
  const traceFor = (i: number): StationTrace =>
    hereAt < 0
      ? NO_TRACE
      : {
          here: i === hereAt,
          next: traced && i === nextAt,
          left: traced && i > lo && i <= hi,
          right: traced && i >= lo && i < hi,
        };

  const relatedIds = new Set<string>();
  if (selected) {
    if (selected.parentId) relatedIds.add(selected.parentId);
    for (const c of board.cards) if (c.parentId === selected.id) relatedIds.add(c.id);
  }

  const words = searchWords(query);
  const isMatch = words.length > 0 ? (card: BoardState['cards'][number]) => cardMatches(card, words, agentName(card.config.agentId)) : null;

  // ------------------------------------------------------ fitting the line
  const cardsByColumn = new Map(columns.map((c) => [c.id, cardsInColumn(board, c.id)] as const));
  const layout = planStations({
    columns,
    counts: new Map(columns.map((c) => [c.id, cardsByColumn.get(c.id)?.length ?? 0] as const)),
    width: boardWidth,
    choice: foldChoice,
    keepOpen: new Set(selected ? [selected.columnId] : []),
    searching: words.length > 0,
  });
  const toggleFold = (columnId: string): void =>
    setFoldChoice((prev) => ({ ...prev, [columnId]: layout.get(columnId) !== 'folded' }));

  // ----------------------------------------------------------- dragging
  const handleDragEnd = (event: DragEndEvent): void => {
    setDraggingId(null);
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

  // What a screen reader hears while a card moves: names, not ids.
  const titleOf = (id: string | number): string =>
    board.cards.find((c) => c.id === String(id))?.title || 'the card';
  const placeOf = (over: Over): string => {
    const data = over.data.current as { type: 'column'; columnId: string } | { type: 'card'; cardId: string } | undefined;
    const columnId =
      data?.type === 'column' ? data.columnId : board.cards.find((c) => c.id === (data?.type === 'card' ? data.cardId : ''))?.columnId;
    return board.columns.find((c) => c.id === columnId)?.title ?? 'a column';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(active.id)} is over ${placeOf(over)}.` : `${titleOf(active.id)} is not over a column.`,
    onDragEnd: ({ active, over }) =>
      over ? `${titleOf(active.id)} was dropped in ${placeOf(over)}.` : `${titleOf(active.id)} was put back.`,
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  const dragged = draggingId ? board.cards.find((c) => c.id === draggingId) : undefined;
  const draggedKey = dragged ? flowKeyOf(board.columns, dragged.columnId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dropUnderPointer}
      onDragStart={(e) => setDraggingId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'Press Enter to open this card. To move it, press Space to pick it up, use the arrow keys, and press Space again to drop it, or Escape to cancel.',
        },
      }}
    >
      <div className={`board${hereAt >= 0 ? ' has-selection' : ''}`} ref={boardEl}>
        {columns.map((column, i) => (
          <Column
            key={column.id}
            board={board}
            column={column}
            cards={cardsByColumn.get(column.id) ?? []}
            width={layout.get(column.id) ?? 'full'}
            onToggleFold={toggleFold}
            agentsById={agentsById}
            selectedCardId={selectedCardId}
            relatedIds={relatedIds}
            isMatch={isMatch}
            trace={traceFor(i)}
            flashing={flashKey !== null && flowKeyOf(board.columns, column.id) === flashKey}
            isFirst={i === 0}
            isLast={i === columns.length - 1}
            onSelectCard={onSelectCard}
            onAddCard={onAddCard}
            onRenameColumn={onRenameColumn}
            onDeleteColumn={onDeleteColumn}
            onQuickMove={onQuickMove}
            canDelete={columns.length > 1}
          />
        ))}
        <div className="board-end">
          <button type="button" className="ghost" onClick={onAddColumn}>
            <Plus size={16} aria-hidden="true" />
            Add column
          </button>
        </div>
      </div>

      <DragOverlay dropAnimation={reducedMotion() ? null : { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
        {dragged ? (
          <div className={`card overlay ${cardStateClass(draggedKey)}`}>
            <CardFace
              card={dragged}
              agent={dragged.config.agentId ? (agentsById.get(dragged.config.agentId) ?? null) : null}
              columnKey={draggedKey}
              waitingFor={isParentDone(board, dragged) ? null : (parentOf(board, dragged)?.title ?? null)}
              stop={nextStop(board, dragged)}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
