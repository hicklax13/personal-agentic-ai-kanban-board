import type { BoardState, Card } from '@shared/types';
import { type FlowKey, flowKeyOf, isParentDone, parentOf } from '@shared/flow';
import { formatWhen } from './time.js';

export interface NextStop {
  /** The station the card goes to next; null at the end of the line or off it. */
  to: FlowKey | null;
  /** Where it goes and what moves it there, in plain words. */
  text: string;
  /**
   * True when the card is held up until the owner acts: work to approve or fix,
   * or a READY card nobody can start. The backlog (TRIAGE, TODO) is not counted.
   */
  needsYou: boolean;
}

/**
 * The next stop on every card: which station comes next and what gets it there.
 *
 * It follows the board's own rules (shared/flow.ts), so what a card says will
 * happen is what the app does: READY starts by itself, a parent in DONE frees
 * its children, a schedule fires on time, and REVIEW and BLOCKED wait for you.
 */
export function nextStop(board: BoardState, card: Card, now: Date = new Date()): NextStop {
  switch (flowKeyOf(board.columns, card.columnId)) {
    case 'triage':
      return { to: 'todo', text: 'TODO, once you have sorted it', needsYou: false };
    case 'todo': {
      const parent = parentOf(board, card);
      return parent && !isParentDone(board, card)
        ? { to: 'ready', text: `READY when “${parent.title || 'Untitled'}” is done`, needsYou: false }
        : { to: 'ready', text: 'READY when you move it there', needsYou: false };
    }
    case 'scheduled':
      return card.scheduledAt
        ? { to: 'ready', text: `READY ${formatWhen(card.scheduledAt, now)}`, needsYou: false }
        : { to: 'ready', text: 'READY once you give it a time', needsYou: true };
    case 'ready':
      return card.config.agentId
        ? { to: 'running', text: 'RUNNING, starts by itself', needsYou: false }
        : { to: 'running', text: 'RUNNING once you choose who does it', needsYou: true };
    case 'running':
      return card.goalMode
        ? { to: 'done', text: 'DONE when the judge agrees', needsYou: false }
        : { to: 'review', text: 'REVIEW when it finishes', needsYou: false };
    case 'blocked':
      return { to: 'ready', text: 'READY after you fix it', needsYou: true };
    case 'review':
      return { to: 'done', text: 'DONE when you approve it', needsYou: true };
    default:
      // DONE is the end of the line, and a column the owner added is off it.
      return { to: null, text: '', needsYou: false };
  }
}
