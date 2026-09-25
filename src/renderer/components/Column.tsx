import { useEffect, useRef, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Ellipsis, FoldHorizontal, Pencil, Plus, Trash, UnfoldHorizontal } from 'lucide-react';
import type { BoardState, Card, Column as ColumnModel, DiscoveredAgent } from '@shared/types';
import { type FlowKey, flowKeyOf, isParentDone, parentOf } from '@shared/flow';
import CardTile from './CardTile.js';
import { StationShield, type StationTone } from './heraldry.js';
import { nextStop } from './nextStop.js';
import type { StationWidth } from './stationLayout.js';
import { formatWhen } from './time.js';

/** Where the selected card sits on the rail, where it goes next, and the rail between. */
export interface StationTrace {
  here: boolean;
  next: boolean;
  /** This station's half of the rail on the left or right lies on that path. */
  left: boolean;
  right: boolean;
}

/** What an empty station is for, so a first-time user learns the line by reading it. */
const EMPTY_TEXT: Record<FlowKey, string> = {
  triage: 'New ideas land here to be sorted.',
  todo: 'Tasks to do. Move one to READY to run it.',
  scheduled: 'Tasks with a start time wait here.',
  ready: 'Tasks here start by themselves.',
  running: 'Nothing is running right now.',
  blocked: 'Nothing is stuck.',
  review: 'Finished work waits here for you to approve.',
  done: 'Approved work ends here.',
};

function toneOf(key: FlowKey | null, count: number): StationTone {
  if (key === 'ready') return 'or';
  if (count === 0) return 'plain';
  if (key === 'running') return 'azure';
  if (key === 'blocked') return 'gules';
  if (key === 'review') return 'purpure';
  if (key === 'done') return 'vert';
  return 'plain';
}

/** The line under a station's name: its state at a glance. */
function noteOf(key: FlowKey | null, cards: Card[], now: Date): { text: string; tone: string } {
  const n = cards.length;
  switch (key) {
    case 'triage':
      return { text: n ? `${n} to sort` : 'new ideas', tone: '' };
    case 'todo':
      return { text: n ? `${n} to do` : 'nothing waiting', tone: '' };
    case 'scheduled': {
      const first = cards
        .map((c) => c.scheduledAt)
        .filter((t): t is string => Boolean(t))
        .sort()[0];
      return { text: first ? `next ${formatWhen(first, now)}` : 'no start times', tone: '' };
    }
    case 'ready':
      return { text: 'starts by itself', tone: 'gold' };
    case 'running':
      return { text: n ? `${n} live` : 'idle', tone: n ? 'live' : '' };
    case 'blocked':
      return { text: n ? `${n} to fix` : 'all clear', tone: n ? 'alert' : '' };
    case 'review':
      return { text: n ? `${n} to approve` : 'all clear', tone: n ? 'review' : '' };
    case 'done':
      return { text: n ? `${n} finished` : 'end of the line', tone: '' };
    default:
      return { text: '', tone: '' };
  }
}

/**
 * The station's options, behind a button that is always in sight: rename,
 * fold or unfold, and delete — which asks here, in the app, before it acts.
 */
function StationMenu({
  title,
  cardCount,
  folded,
  canDelete,
  onRename,
  onToggleFold,
  onDelete,
}: {
  title: string;
  cardCount: number;
  folded: boolean;
  canDelete: boolean;
  onRename: () => void;
  onToggleFold: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const close = (): void => {
    setOpen(false);
    setConfirming(false);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="station-menu" ref={root}>
      <button
        type="button"
        className="icon-button station-menu-button"
        aria-expanded={open}
        aria-label={`Options for ${title}`}
        title="Station options"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Ellipsis size={17} aria-hidden="true" />
      </button>
      {open ? (
        <div className="menu" aria-label={`${title} options`}>
          {confirming ? (
            <div className="menu-confirm" role="alertdialog" aria-label={`Delete ${title}?`}>
              <p>
                Delete <b>{title}</b>?{' '}
                {cardCount > 0
                  ? `Its ${cardCount} card${cardCount === 1 ? '' : 's'} will move to the first station.`
                  : 'It holds no cards.'}
              </p>
              <div className="menu-confirm-actions">
                <button
                  type="button"
                  className="danger solid"
                  onClick={() => {
                    close();
                    onDelete();
                  }}
                >
                  Delete station
                </button>
                <button type="button" onClick={() => setConfirming(false)} autoFocus>
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  close();
                  onRename();
                }}
              >
                <Pencil size={15} aria-hidden="true" />
                Rename
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  close();
                  onToggleFold();
                }}
              >
                {folded ? <UnfoldHorizontal size={15} aria-hidden="true" /> : <FoldHorizontal size={15} aria-hidden="true" />}
                {folded ? 'Show its cards' : 'Fold this station'}
              </button>
              {canDelete ? (
                <button type="button" className="menu-item danger-item" onClick={() => setConfirming(true)}>
                  <Trash size={15} aria-hidden="true" />
                  Delete station…
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface Props {
  board: BoardState;
  column: ColumnModel;
  cards: Card[];
  agentsById: Map<string, DiscoveredAgent>;
  selectedCardId: string | null;
  /** The selected card's parent and children. */
  relatedIds: Set<string>;
  /** Null when the search box is empty. */
  isMatch: ((card: Card) => boolean) | null;
  trace: StationTrace;
  /** Briefly pointed out after a click on the status line. */
  flashing: boolean;
  /** Full, narrow (empty and short of room) or folded to its shield and name. */
  width: StationWidth;
  isFirst: boolean;
  isLast: boolean;
  onSelectCard: (id: string) => void;
  onAddCard: (columnId: string) => void;
  onRenameColumn: (columnId: string, title: string) => void;
  onDeleteColumn: (columnId: string) => void;
  onToggleFold: (columnId: string) => void;
  onQuickMove: (cardId: string, to: FlowKey) => void;
  canDelete: boolean;
}

/**
 * One station on the line: its shield on the gilded rail with the count of
 * cards it holds, its name on a scroll beneath (the crest's own shield over
 * scroll), a one-line state, then the station's cards. Folded, it keeps its
 * shield on the rail and its name, and still takes dropped cards.
 */
export default function Column({
  board,
  column,
  cards,
  agentsById,
  selectedCardId,
  relatedIds,
  isMatch,
  trace,
  flashing,
  width,
  isFirst,
  isLast,
  onSelectCard,
  onAddCard,
  onRenameColumn,
  onDeleteColumn,
  onToggleFold,
  onQuickMove,
  canDelete,
}: Props): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${column.id}`,
    data: { type: 'column', columnId: column.id },
  });
  const titleRef = useRef<HTMLInputElement>(null);

  const key = flowKeyOf(board.columns, column.id);
  const now = new Date();
  const folded = width === 'folded';
  const overWip = column.wipLimit !== null && cards.length > column.wipLimit;
  const note =
    column.wipLimit !== null
      ? { text: `${cards.length} of ${column.wipLimit} max`, tone: overWip ? 'alert' : '' }
      : noteOf(key, cards, now);
  const lit = trace.here || flashing ? 'here' : trace.next ? 'next' : null;
  const countText = `${cards.length} card${cards.length === 1 ? '' : 's'}`;

  const classes = [
    'column',
    `station-${key ?? 'custom'}`,
    cards.length === 0 ? 'is-empty' : '',
    width === 'narrow' ? 'is-narrow' : '',
    folded ? 'is-folded' : '',
    isFirst ? 'first-station' : '',
    isLast ? 'last-station' : '',
    isOver ? 'drop-target' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const headClasses = [
    'column-head',
    lit ? `lit-${lit}` : '',
    trace.left ? 'trace-left' : '',
    trace.right ? 'trace-right' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const shield = <StationShield count={cards.length} tone={toneOf(key, cards.length)} lit={lit} />;

  if (folded) {
    return (
      <section className={classes} id={key ? `station-${key}` : undefined} aria-label={`${column.title}, folded`}>
        <header className={headClasses}>{shield}</header>
        <button
          type="button"
          ref={setNodeRef}
          className="fold-marker"
          onClick={() => onToggleFold(column.id)}
          aria-label={`Show ${column.title}, ${countText}`}
          title={`Show ${column.title}`}
        >
          <span className="fold-name">{column.title}</span>
          <span className="fold-count">{countText}</span>
          <UnfoldHorizontal size={16} aria-hidden="true" />
        </button>
      </section>
    );
  }

  return (
    <section className={classes} id={key ? `station-${key}` : undefined} aria-label={column.title}>
      <header className={headClasses}>
        {shield}
        <div className="ribbon">
          <input
            ref={titleRef}
            className="column-title"
            value={column.title}
            onChange={(e) => onRenameColumn(column.id, e.target.value)}
            aria-label={`Station name, ${countText}`}
            title="Click to rename"
            spellCheck={false}
          />
        </div>
        <div className={`station-note${trace.next ? ' gold' : note.tone ? ` ${note.tone}` : ''}`}>
          {trace.next ? 'next stop' : note.text}
        </div>
      </header>

      <div className="column-body" ref={setNodeRef}>
        {cards.map((card) => (
          <CardTile
            key={card.id}
            card={card}
            agent={card.config.agentId ? (agentsById.get(card.config.agentId) ?? null) : null}
            selected={card.id === selectedCardId}
            related={relatedIds.has(card.id)}
            dimmed={isMatch ? !isMatch(card) : false}
            onSelect={() => onSelectCard(card.id)}
            columnKey={key}
            waitingFor={isParentDone(board, card) ? null : (parentOf(board, card)?.title ?? null)}
            stop={nextStop(board, card, now)}
            onMove={(to) => onQuickMove(card.id, to)}
          />
        ))}
        {cards.length === 0 ? <div className="lane-empty">{key ? EMPTY_TEXT[key] : 'Drop a card here.'}</div> : null}
      </div>

      <footer className="column-foot">
        <button
          type="button"
          className="ghost add-task"
          onClick={() => onAddCard(column.id)}
          aria-label={`New task in ${column.title}`}
        >
          <Plus size={16} aria-hidden="true" />
          New task
        </button>
        <StationMenu
          title={column.title}
          cardCount={cards.length}
          folded={false}
          canDelete={canDelete}
          onRename={() => {
            titleRef.current?.focus();
            titleRef.current?.select();
          }}
          onToggleFold={() => onToggleFold(column.id)}
          onDelete={() => onDeleteColumn(column.id)}
        />
      </footer>
    </section>
  );
}
