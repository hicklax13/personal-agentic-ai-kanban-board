import { describe, expect, it } from 'vitest';
import { flowColumn, type FlowKey } from '../shared/flow.js';
import { createDefaultBoard } from '../src/main/store/schema.js';
import { planStations, STATION_PX, type StationLayoutInput } from '../src/renderer/components/stationLayout.js';

const columns = createDefaultBoard(null).columns;
const id = (key: FlowKey): string => (flowColumn(columns, key) as { id: string }).id;

/** Every station holding `n` cards unless given otherwise. */
function counts(n: number, overrides: Partial<Record<FlowKey, number>> = {}): Map<string, number> {
  return new Map(
    (['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done'] as FlowKey[]).map((k) => [
      id(k),
      overrides[k] ?? n,
    ]),
  );
}

function plan(input: Partial<StationLayoutInput>): Record<FlowKey, string> {
  const result = planStations({
    columns,
    counts: counts(2),
    width: 4000,
    choice: {},
    keepOpen: new Set(),
    searching: false,
    ...input,
  });
  const keys: FlowKey[] = ['triage', 'todo', 'scheduled', 'ready', 'running', 'blocked', 'review', 'done'];
  return Object.fromEntries(keys.map((k) => [k, result.get(id(k)) as string])) as Record<FlowKey, string>;
}

/** Width the whole line needs with every station full. */
const FULL_LINE = STATION_PX.edges + STATION_PX.addColumn + 8 * (STATION_PX.full + STATION_PX.gap);

describe('fitting the line to the window', () => {
  it('keeps every station full width when there is room', () => {
    expect(Object.values(plan({ width: FULL_LINE }))).toEqual(Array(8).fill('full'));
  });

  it('narrows empty stations before folding anything', () => {
    // Two full stations and six narrow ones need 1468px: narrowing alone makes it fit.
    const p = plan({ width: 1500, counts: counts(0, { todo: 1, running: 1 }) });
    expect(p.ready).toBe('narrow');
    expect(p.running).toBe('full');
    expect(Object.values(p)).not.toContain('folded');
  });

  it('never folds away the only cards a board has when nothing is live', () => {
    // A first run: one welcome card in TODO, every other station empty.
    const p = plan({ width: 1200, counts: counts(0, { todo: 1 }) });
    expect(p.todo).toBe('full');
    expect(Object.values(p)).not.toContain('folded');
  });

  it('on a laptop folds the quieter stations and keeps the live middle open', () => {
    const p = plan({ width: 1366 });
    expect([p.done, p.triage, p.scheduled, p.todo]).toEqual(['folded', 'folded', 'folded', 'folded']);
    expect([p.ready, p.running, p.blocked, p.review]).toEqual(['full', 'full', 'full', 'full']);
  });

  it('folds only as many as it needs, least urgent first', () => {
    const p = plan({ width: FULL_LINE - 20 });
    expect(p.done).toBe('folded');
    expect([p.triage, p.scheduled, p.todo]).toEqual(['full', 'full', 'full']);
  });

  it('never folds the station of the selected card by itself', () => {
    const p = plan({ width: 1366, keepOpen: new Set([id('done')]) });
    expect(p.done).toBe('full');
    expect(p.triage).toBe('folded');
  });

  it("follows the owner's own choice either way", () => {
    expect(plan({ width: 1366, choice: { [id('todo')]: false } }).todo).toBe('full');
    expect(plan({ width: 4000, choice: { [id('running')]: true } }).running).toBe('folded');
  });

  it('folds nothing by itself while searching, so every match stays in view', () => {
    const p = plan({ width: 1366, searching: true, counts: counts(2, { scheduled: 0 }) });
    expect(Object.values(p)).not.toContain('folded');
    expect(p.scheduled).toBe('narrow');
  });
});
