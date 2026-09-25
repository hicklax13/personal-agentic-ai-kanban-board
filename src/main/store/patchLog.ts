import type { BoardState, Card, CardWorkflowPatch } from '@shared/types';

type WorkflowField = keyof CardWorkflowPatch;

/**
 * Keeps the window's whole-board saves from undoing the workflow's changes.
 *
 * The main process changes cards on its own (a schedule fires, a parent
 * finishes, a run ends) and pushes each change to the window. The window, in
 * turn, saves its whole board a moment after the user edits anything. A save
 * that was put together before a change arrived would silently put the card
 * back — so every change gets a rising number, the window says with each save
 * the highest number it had applied, and any field changed above that is laid
 * back over the saved copy.
 *
 * Numbers are kept per field: a later change to one field must not re-apply an
 * earlier, already-seen change to another — the user may have changed that one
 * since, for instance by dragging the card somewhere else.
 */
export class PatchLog {
  private seq = 0;
  private unseen = new Map<string, Map<WorkflowField, { seq: number; value: unknown }>>();

  /** The number of the latest change. */
  get latest(): number {
    return this.seq;
  }

  /** Note a change and return its number. */
  record(cardId: string, patch: CardWorkflowPatch): number {
    const seq = ++this.seq;
    const fields = this.unseen.get(cardId) ?? new Map<WorkflowField, { seq: number; value: unknown }>();
    for (const [field, value] of Object.entries(patch)) fields.set(field as WorkflowField, { seq, value });
    this.unseen.set(cardId, fields);
    return seq;
  }

  /**
   * Merge a board saved by the window (`incoming`, which had seen changes up to
   * `seenSeq`) into the main process's copy (`current`).
   *
   * Run history, the Goal loop's progress, the worktree and the blocked reason
   * are only ever written by the main process, so its copy of them always wins.
   */
  merge(current: BoardState, incoming: BoardState, seenSeq: number): BoardState {
    const mine = new Map(current.cards.map((c) => [c.id, c] as const));
    const cards = incoming.cards.map((c): Card => {
      const own = mine.get(c.id);
      let card: Card = own
        ? {
            ...c,
            runs: own.runs,
            lastRunId: own.lastRunId,
            goal: own.goal,
            worktreePath: own.worktreePath,
            blockedReason: own.blockedReason,
          }
        : c;
      const later: Record<string, unknown> = {};
      for (const [field, entry] of this.unseen.get(c.id) ?? []) {
        if (entry.seq > seenSeq) later[field] = entry.value;
      }
      if (Object.keys(later).length > 0) card = { ...card, ...(later as CardWorkflowPatch) };
      return card;
    });

    // What the window has now seen needs no protecting any more.
    for (const [cardId, fields] of this.unseen) {
      for (const [field, entry] of fields) if (entry.seq <= seenSeq) fields.delete(field);
      if (fields.size === 0) this.unseen.delete(cardId);
    }
    return { ...incoming, cards };
  }
}
