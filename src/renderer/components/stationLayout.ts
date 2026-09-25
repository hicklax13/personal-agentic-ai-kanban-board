import type { Column } from '@shared/types';
import { type FlowKey, flowColumn } from '@shared/flow';

/** How much of the line a station takes: all of it, a narrow empty one, or folded to its shield and name. */
export type StationWidth = 'full' | 'narrow' | 'folded';

/** Widths in CSS pixels, kept in step with styles.css (--col-min, --col-narrow, --col-folded, --col-gap). */
export const STATION_PX = { full: 204, narrow: 132, folded: 64, gap: 12, edges: 32, addColumn: 140 } as const;

/**
 * Stations that fold first when the line is short of room: the finished, the
 * unsorted, the scheduled and the backlog. The live middle of the line (READY,
 * RUNNING, BLOCKED, REVIEW) never folds by itself.
 */
export const FOLD_FIRST: FlowKey[] = ['done', 'triage', 'scheduled', 'todo'];

/** The live middle of the line, which folding exists to keep in view. */
const LIVE: FlowKey[] = ['ready', 'running', 'blocked', 'review'];

export interface StationLayoutInput {
  /** In board order. */
  columns: Column[];
  /** Cards per column id. */
  counts: Map<string, number>;
  /** The board's width in CSS pixels. */
  width: number;
  /** The owner's own choice per station: true folded, false kept open. */
  choice: Record<string, boolean>;
  /** Stations that must not fold by themselves (the selected card's). */
  keepOpen: Set<string>;
  /** While searching nothing folds by itself, so every match stays in view. */
  searching: boolean;
}

/**
 * Fit the line to the window. With room to spare every station is full width.
 * Short of room, empty stations go narrow first. Then, only if there is live
 * work to keep in view, the quieter stations fold one at a time, least urgent
 * first, until the line fits — a board with nothing live just scrolls, rather
 * than folding away the only cards it has. The owner's own fold or unfold of a
 * station always wins.
 */
export function planStations({
  columns,
  counts,
  width,
  choice,
  keepOpen,
  searching,
}: StationLayoutInput): Map<string, StationWidth> {
  const plan = new Map<string, StationWidth>(
    columns.map((c) => [c.id, choice[c.id] === true ? 'folded' : 'full'] as const),
  );
  const needed = (): number =>
    STATION_PX.edges +
    STATION_PX.addColumn +
    STATION_PX.gap * columns.length +
    columns.reduce((sum, c) => sum + STATION_PX[plan.get(c.id) ?? 'full'], 0);

  if (needed() <= width) return plan;

  for (const c of columns) {
    if (plan.get(c.id) === 'full' && (counts.get(c.id) ?? 0) === 0) plan.set(c.id, 'narrow');
  }
  if (searching) return plan;
  const liveWork = LIVE.some((key) => {
    const c = flowColumn(columns, key);
    return Boolean(c && (counts.get(c.id) ?? 0) > 0);
  });
  if (!liveWork) return plan;

  for (const key of FOLD_FIRST) {
    if (needed() <= width) break;
    const c = flowColumn(columns, key);
    if (!c || keepOpen.has(c.id) || choice[c.id] === false || plan.get(c.id) !== 'full') continue;
    plan.set(c.id, 'folded');
  }
  return plan;
}
