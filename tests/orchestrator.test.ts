import { describe, expect, it } from 'vitest';
import { Orchestrator, type OrchestratorDeps } from '../src/main/dispatch/orchestrator.js';
import type { StartOptions, StartResult } from '../src/main/dispatch/dispatcher.js';
import { addCard, applyCardPatch, findCard } from '../shared/boardOps.js';
import { flowColumn, flowKeyOf, type FlowKey } from '../shared/flow.js';
import { DEFAULT_JUDGE } from '../src/main/settings.js';
import { createDefaultBoard } from '../src/main/store/schema.js';
import type { AgentRun, BoardState, Card, JudgeSettings, RunUpdate } from '../shared/types.js';

/** What a scripted run does. */
interface Step {
  status?: AgentRun['status'];
  output?: string;
  error?: string;
  session?: string;
}

interface Call {
  cardId: string;
  role: string;
  round: number | undefined;
  opts: StartOptions;
  agentId: string | null;
}

/**
 * Stands in for the real dispatcher: each call takes the next scripted step for
 * its role, so a test can say "the worker succeeds, then the judge says continue".
 */
class ScriptedDispatcher {
  calls: Call[] = [];
  annotations: RunUpdate[] = [];
  private running = new Set<string>();
  private gates: (() => void)[] = [];
  holdRuns = false;

  constructor(private readonly script: Record<string, Step[]>) {}

  async start(card: Card, _root: string | null, opts: StartOptions = {}): Promise<StartResult> {
    const role = opts.role ?? 'worker';
    const agentId = opts.configOverride?.agentId ?? card.config.agentId;
    this.calls.push({ cardId: card.id, role, round: opts.round, opts, agentId });
    this.running.add(card.id);
    if (this.holdRuns) await new Promise<void>((resolve) => this.gates.push(resolve));
    const step = this.script[`${card.id}:${role}`]?.shift() ?? {};
    this.running.delete(card.id);
    const run: AgentRun = {
      id: `run-${this.calls.length}`,
      cardId: card.id,
      agentId: agentId ?? 'none',
      providerId: null,
      model: null,
      status: step.status ?? 'succeeded',
      prompt: opts.prompt ?? card.title,
      output: step.output ?? '',
      events: [],
      error: step.error ?? null,
      exitCode: 0,
      agentSessionId: step.session ?? null,
      startedAt: '',
      endedAt: '',
      command: null,
      role: opts.role,
      round: opts.round,
    };
    return run.status === 'succeeded'
      ? { ok: true, runId: run.id, run }
      : { ok: false, runId: run.id, run, error: run.error ?? 'failed' };
  }

  release(): void {
    for (const g of this.gates.splice(0)) g();
  }

  cancel(): boolean {
    return false;
  }

  isRunning(cardId: string): boolean {
    return this.running.has(cardId);
  }

  async annotate(update: RunUpdate): Promise<void> {
    this.annotations.push(update);
  }
}

const JUDGE: JudgeSettings = { ...DEFAULT_JUDGE, agentId: 'claude-code', model: 'haiku', maxRounds: 3, allowedTools: ['Read'] };

function setup(
  script: Record<string, Step[]>,
  opts: { judge?: JudgeSettings; now?: Date } = {},
): { orch: Orchestrator; disp: ScriptedDispatcher; board: () => BoardState; set: (b: BoardState) => void } {
  let board: BoardState = { ...createDefaultBoard('C:/ws'), cards: [] };
  const disp = new ScriptedDispatcher(script);
  const deps: OrchestratorDeps = {
    getBoard: () => board,
    patchCard: async (cardId, patch) => {
      board = applyCardPatch(board, cardId, patch);
    },
    dispatcher: disp,
    judge: () => opts.judge ?? JUDGE,
    prepareWorkspace: async () => ({ ok: true, cwd: 'C:/ws' }),
    needsFolder: () => true,
    ready: () => true,
    now: () => opts.now ?? new Date('2026-09-25T12:00:00.000Z'),
  };
  return {
    orch: new Orchestrator(deps),
    disp,
    board: () => board,
    set: (b) => {
      board = b;
    },
  };
}

function add(
  env: ReturnType<typeof setup>,
  id: string,
  key: FlowKey,
  fields: Partial<Card> & { agentId?: string | null } = {},
): void {
  const b = env.board();
  const { agentId = 'codex', ...rest } = fields;
  env.set(
    addCard(b, (flowColumn(b.columns, key) as { id: string }).id, {
      id,
      title: rest.title ?? id,
      description: rest.description ?? '',
      priority: rest.priority,
      parentId: rest.parentId ?? null,
      scheduledAt: rest.scheduledAt ?? null,
      goalMode: rest.goalMode,
      config: { agentId },
    }),
  );
}

const where = (env: ReturnType<typeof setup>, id: string): FlowKey | null =>
  flowKeyOf(env.board().columns, (findCard(env.board(), id) as Card).columnId);

const card = (env: ReturnType<typeof setup>, id: string): Card => findCard(env.board(), id) as Card;

/** Let every fire-and-forget run and follow-up tick finish. */
async function drain(): Promise<void> {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('one run', () => {
  it('Send to Agent runs the card and moves it to REVIEW', async () => {
    const env = setup({ 'a:worker': [{ output: 'did it' }] });
    add(env, 'a', 'todo');
    const res = await env.orch.startNow('a');
    expect(res.ok).toBe(true);
    expect(where(env, 'a')).toBe('review');
    expect(env.disp.calls).toHaveLength(1);
    expect(env.disp.calls[0].opts.cwd).toBe('C:/ws');
  });

  it('a failed run goes to BLOCKED with the reason', async () => {
    const env = setup({ 'a:worker': [{ status: 'failed', error: 'quota exceeded' }] });
    add(env, 'a', 'todo');
    await env.orch.startNow('a');
    expect(where(env, 'a')).toBe('blocked');
    expect(card(env, 'a').blockedReason).toBe('Run failed: quota exceeded');
  });

  it('a cancelled run is parked in TODO, not READY, so it does not start again', async () => {
    const env = setup({ 'a:worker': [{ status: 'cancelled' }] });
    add(env, 'a', 'todo');
    await env.orch.startNow('a');
    expect(where(env, 'a')).toBe('todo');
  });

  it('refuses a card with nobody assigned', async () => {
    const env = setup({});
    add(env, 'a', 'todo', { agentId: null });
    expect((await env.orch.startNow('a')).error).toMatch(/Choose who does this task/);
    expect(env.disp.calls).toHaveLength(0);
  });

  it('parks a card whose parent is unfinished in TODO and says why', async () => {
    const env = setup({});
    add(env, 'p', 'review', { title: 'Parent task' });
    add(env, 'c', 'triage', { parentId: 'p' });
    const res = await env.orch.startNow('c');
    expect(res).toMatchObject({ ok: true, queued: true });
    expect(res.info).toContain('Parent task');
    expect(where(env, 'c')).toBe('todo');
    expect(env.disp.calls).toHaveLength(0);
  });
});

describe('the workflow', () => {
  it('starts a READY card by itself', async () => {
    const env = setup({ 'a:worker': [{}] });
    add(env, 'a', 'ready');
    await env.orch.tick();
    await drain();
    expect(where(env, 'a')).toBe('review');
  });

  it('starts a scheduled card when its time comes, not before', async () => {
    const env = setup({ 'a:worker': [{}] }, { now: new Date('2026-09-25T12:00:00.000Z') });
    add(env, 'a', 'scheduled', { scheduledAt: '2026-09-25T12:30:00.000Z' });
    await env.orch.tick();
    await drain();
    expect(where(env, 'a')).toBe('scheduled');

    const due = setup({ 'a:worker': [{}] }, { now: new Date('2026-09-25T12:31:00.000Z') });
    add(due, 'a', 'scheduled', { scheduledAt: '2026-09-25T12:30:00.000Z' });
    await due.orch.tick();
    await drain();
    expect(where(due, 'a')).toBe('review');
  });

  it('runs a child by itself once its Goal-mode parent is judged done', async () => {
    const env = setup({
      'p:worker': [{ output: 'built it' }],
      'p:judge': [{ output: '{"verdict":"done","reason":"verified"}' }],
      'c:worker': [{ output: 'child done' }],
    });
    add(env, 'p', 'ready', { goalMode: true });
    add(env, 'c', 'todo', { parentId: 'p' });
    await env.orch.tick();
    await drain();
    expect(where(env, 'p')).toBe('done');
    expect(where(env, 'c')).toBe('review');
    expect(env.disp.calls.map((c) => `${c.cardId}:${c.role}`)).toEqual(['p:worker', 'p:judge', 'c:worker']);
  });

  it('never runs more than three cards at once, and starts the next when one finishes', async () => {
    const env = setup({});
    env.disp.holdRuns = true;
    for (const id of ['a', 'b', 'c', 'd']) add(env, id, 'ready');
    await env.orch.tick();
    await drain();
    expect(env.disp.calls.map((c) => c.cardId)).toEqual(['a', 'b', 'c']);

    env.disp.release();
    await drain();
    expect(env.disp.calls.map((c) => c.cardId)).toEqual(['a', 'b', 'c', 'd']);
    env.disp.release();
    await drain();
    for (const id of ['a', 'b', 'c', 'd']) expect(where(env, id)).toBe('review');
  });

  it('sends a READY card to BLOCKED when it cannot start, instead of retrying forever', async () => {
    const env = setup({}, { judge: { ...DEFAULT_JUDGE } });
    add(env, 'a', 'ready', { goalMode: true });
    await env.orch.tick();
    await drain();
    expect(where(env, 'a')).toBe('blocked');
    expect(card(env, 'a').blockedReason).toMatch(/needs a judge/);
  });
});

describe('Goal mode', () => {
  it('loops until the judge agrees, continuing the worker’s own session with the feedback', async () => {
    const env = setup({
      'g:worker': [{ output: 'first try', session: 'sess-1' }, { output: 'fixed the tests' }],
      'g:judge': [
        { output: 'Tests fail.\n{"verdict":"continue","reason":"Two tests fail."}' },
        { output: '{"verdict":"done","reason":"All tests pass."}' },
      ],
    });
    add(env, 'g', 'todo', { goalMode: true, description: 'Done when tests pass.' });
    const res = await env.orch.startNow('g');

    expect(res.ok).toBe(true);
    expect(where(env, 'g')).toBe('done');
    expect(card(env, 'g').goal).toMatchObject({ status: 'done', round: 2, maxRounds: 3, reason: 'All tests pass.' });

    const [w1, j1, w2, j2] = env.disp.calls;
    expect([w1.role, j1.role, w2.role, j2.role]).toEqual(['worker', 'judge', 'worker', 'judge']);
    expect(w2.opts.resumeSessionId).toBe('sess-1');
    expect(w2.opts.prompt).toContain('Two tests fail.');
    // The judge is its own agent, with its own tools, in a fresh session.
    expect(j1.agentId).toBe('claude-code');
    expect(j1.opts.configOverride).toMatchObject({ model: 'haiku', allowedTools: ['Read'] });
    expect(j1.opts.resumeSessionId).toBeNull();
    expect(j1.opts.prompt).toContain('Done when tests pass.');
    expect(env.disp.annotations.map((a) => a.run.verdict?.verdict)).toEqual(['continue', 'done']);
  });

  it('hands the card to a person in BLOCKED when the rounds run out', async () => {
    const env = setup({
      'g:worker': [{}, {}, {}],
      'g:judge': [
        { output: '{"verdict":"continue","reason":"a"}' },
        { output: '{"verdict":"continue","reason":"b"}' },
        { output: '{"verdict":"continue","reason":"still no docs"}' },
      ],
    });
    add(env, 'g', 'todo', { goalMode: true });
    const res = await env.orch.startNow('g');
    expect(res.ok).toBe(false);
    expect(where(env, 'g')).toBe('blocked');
    expect(card(env, 'g').blockedReason).toMatch(/after 3 rounds.*still no docs/);
    expect(env.disp.calls.filter((c) => c.role === 'worker')).toHaveLength(3);
  });

  it('stops at once when the judge says the task cannot be done as written', async () => {
    const env = setup({
      'g:worker': [{}],
      'g:judge': [{ output: '{"verdict":"blocked","reason":"Needs a paid API key."}' }],
    });
    add(env, 'g', 'todo', { goalMode: true });
    await env.orch.startNow('g');
    expect(where(env, 'g')).toBe('blocked');
    expect(card(env, 'g').blockedReason).toContain('Needs a paid API key.');
    expect(env.disp.calls).toHaveLength(2);
  });

  it('keeps going when the judge gives no clear answer', async () => {
    const env = setup({
      'g:worker': [{}, {}],
      'g:judge': [{ output: 'Looks fine, I think.' }, { output: '{"verdict":"done","reason":"ok"}' }],
    });
    add(env, 'g', 'todo', { goalMode: true });
    await env.orch.startNow('g');
    expect(where(env, 'g')).toBe('done');
    expect(env.disp.annotations[0].run.verdict?.verdict).toBe('continue');
  });

  it('stops after the judge fails to run twice in a row, rather than wasting every round', async () => {
    const env = setup({
      'g:worker': [{}, {}, {}],
      'g:judge': [
        { status: 'failed', error: 'not signed in' },
        { status: 'failed', error: 'not signed in' },
      ],
    });
    add(env, 'g', 'todo', { goalMode: true });
    await env.orch.startNow('g');
    expect(where(env, 'g')).toBe('blocked');
    expect(card(env, 'g').blockedReason).toMatch(/judge could not run: not signed in/);
    expect(env.disp.calls.filter((c) => c.role === 'worker')).toHaveLength(2);
  });

  it('a worker failure ends the loop in BLOCKED', async () => {
    const env = setup({ 'g:worker': [{ status: 'failed', error: 'crashed' }] });
    add(env, 'g', 'todo', { goalMode: true });
    await env.orch.startNow('g');
    expect(where(env, 'g')).toBe('blocked');
    expect(card(env, 'g').goal?.status).toBe('blocked');
    expect(env.disp.calls).toHaveLength(1);
  });

  it('refuses to start without a judge when started by hand, and leaves the card where it is', async () => {
    const env = setup({}, { judge: { ...DEFAULT_JUDGE } });
    add(env, 'g', 'todo', { goalMode: true });
    const res = await env.orch.startNow('g');
    expect(res.error).toMatch(/needs a judge/);
    expect(where(env, 'g')).toBe('todo');
  });

  it('Stop ends the loop after the current step and parks the card in TODO', async () => {
    const env = setup({ 'g:worker': [{}], 'g:judge': [{ output: '{"verdict":"continue","reason":"more"}' }] });
    add(env, 'g', 'todo', { goalMode: true });
    env.disp.holdRuns = true;
    const pending = env.orch.startNow('g');
    await drain();
    expect(env.orch.cancel('g')).toBe(true);
    env.disp.release();
    const res = await pending;
    expect(res.error).toBe('Stopped by the user.');
    expect(where(env, 'g')).toBe('todo');
    expect(card(env, 'g').goal?.status).toBe('stopped');
    expect(env.disp.calls).toHaveLength(1);
  });
});
