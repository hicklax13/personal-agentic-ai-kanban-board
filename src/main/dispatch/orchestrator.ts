import type {
  BoardState,
  Card,
  CardWorkflowPatch,
  DispatchResult,
  GoalState,
  JudgeSettings,
  JudgeVerdict,
} from '@shared/types';
import {
  flowColumn,
  isParentDone,
  MAX_AUTO_RUNS,
  outcomeColumn,
  parentOf,
  planFlow,
  type RunOutcome,
} from '@shared/flow';
import type { Dispatcher, StartResult } from './dispatcher.js';
import { buildContinuationPrompt, buildJudgePrompt, parseVerdict } from './judge.js';
import type { WorkspaceResult } from './workspace.js';

export interface OrchestratorDeps {
  getBoard(): BoardState;
  /** Change a card's workflow fields: save them, then tell the window. */
  patchCard(cardId: string, patch: CardWorkflowPatch): Promise<void>;
  dispatcher: Pick<Dispatcher, 'start' | 'cancel' | 'isRunning' | 'annotate'>;
  judge(): JudgeSettings;
  /** Resolve (and for worktrees, create) the folder a card runs in. */
  prepareWorkspace(card: Card): Promise<WorkspaceResult>;
  /** False for agents reached over HTTP, which never use a folder. */
  needsFolder(agentId: string): boolean;
  /** False until the agents are known; nothing starts before then. */
  ready(): boolean;
  now(): Date;
}

type Trigger = 'manual' | 'auto';

/** Consecutive judge failures after which a Goal loop stops instead of guessing on. */
const JUDGE_FAILURE_LIMIT = 2;

/**
 * Runs the board's workflow (see `shared/flow.ts` for the rules).
 *
 * - `tick()` applies the rules: due and unblocked cards move to READY, READY
 *   cards start. It is called on a timer and after anything that could change
 *   the answer — a save from the window, a finished run.
 * - `startNow()` is "Send to Agent".
 * - A card is run either once, or — in Goal mode — in rounds: the worker works,
 *   the judge checks, and the judge's feedback goes back to the worker in the
 *   same session until the judge says done, says it cannot be done, or the
 *   round limit is reached.
 *
 * Where a card ends up is decided here and nowhere else.
 */
export class Orchestrator {
  /** Cards being run, from preparing the folder to the final move — a Goal loop spans many runs. */
  private looping = new Set<string>();
  /** Cards whose loop should stop at the next step. */
  private stopRequested = new Set<string>();
  private ticking = false;
  private tickAgain = false;

  constructor(private readonly deps: OrchestratorDeps) {}

  isBusy(cardId: string): boolean {
    return this.looping.has(cardId) || this.deps.dispatcher.isRunning(cardId);
  }

  /** Apply the workflow rules once. Overlapping calls fold into one extra pass. */
  async tick(): Promise<void> {
    if (!this.deps.ready()) return;
    if (this.ticking) {
      this.tickAgain = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.tickAgain = false;
        const board = this.deps.getBoard();
        const plan = planFlow(board, this.deps.now(), {
          isRunning: (id) => this.isBusy(id),
          slots: MAX_AUTO_RUNS - this.looping.size,
        });
        for (const move of plan.moves) {
          const target = flowColumn(board.columns, move.to);
          if (target) await this.deps.patchCard(move.cardId, { columnId: target.id });
        }
        // Not awaited: each card runs on its own; `run` claims the card before
        // its first await, so the next pass already sees it as busy.
        for (const cardId of plan.start) void this.run(cardId, 'auto');
      } while (this.tickAgain);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * "Send to Agent". Runs now — unless the card's parent is unfinished, in which
   * case it waits in TODO and starts by itself once the parent reaches DONE.
   */
  async startNow(cardId: string): Promise<DispatchResult> {
    const board = this.deps.getBoard();
    const card = board.cards.find((c) => c.id === cardId);
    if (!card) return { ok: false, error: 'Card not found.' };
    if (this.isBusy(cardId)) return { ok: false, error: 'This card is already running.' };
    if (!card.config.agentId) return { ok: false, error: 'Choose who does this task first.' };

    if (!isParentDone(board, card)) {
      const todo = flowColumn(board.columns, 'todo');
      if (todo && card.columnId !== todo.id) await this.deps.patchCard(cardId, { columnId: todo.id });
      const parent = parentOf(board, card);
      return {
        ok: true,
        queued: true,
        info: `Waiting for "${parent?.title ?? 'its parent'}" to finish. It will start by itself when that card reaches DONE.`,
      };
    }
    return this.run(cardId, 'manual');
  }

  /** Stop a card: the current run is cancelled and a Goal loop does not go on. */
  cancel(cardId: string): boolean {
    const looping = this.looping.has(cardId);
    if (looping) this.stopRequested.add(cardId);
    return this.deps.dispatcher.cancel(cardId) || looping;
  }

  // -------------------------------------------------------------------------

  private card(cardId: string): Card | undefined {
    return this.deps.getBoard().cards.find((c) => c.id === cardId);
  }

  private async move(cardId: string, outcome: RunOutcome, extra: CardWorkflowPatch = {}): Promise<void> {
    const board = this.deps.getBoard();
    const card = board.cards.find((c) => c.id === cardId);
    if (!card) return;
    const to = outcomeColumn(board.columns, outcome, card.columnId);
    const patch: CardWorkflowPatch = { ...extra, ...(to ? { columnId: to } : {}) };
    if (Object.keys(patch).length > 0) await this.deps.patchCard(cardId, patch);
  }

  private async setGoal(cardId: string, goal: Omit<GoalState, 'updatedAt'>): Promise<void> {
    await this.deps.patchCard(cardId, { goal: { ...goal, updatedAt: this.deps.now().toISOString() } });
  }

  private summary(res: StartResult): DispatchResult {
    return { ok: res.ok, runId: res.runId, ...(res.error ? { error: res.error } : {}) };
  }

  /**
   * A card that cannot start. Started by the user, it stays put and the error is
   * shown; started by the workflow, it goes to BLOCKED — left in READY it would
   * be retried, and fail, every few seconds.
   */
  private async refuse(cardId: string, error: string, trigger: Trigger): Promise<DispatchResult> {
    if (trigger === 'auto') await this.move(cardId, 'failed', { blockedReason: error });
    return { ok: false, error };
  }

  /** Run a card to its outcome: one run, or a whole Goal loop. */
  private async run(cardId: string, trigger: Trigger): Promise<DispatchResult> {
    if (this.looping.has(cardId)) return { ok: false, error: 'This card is already running.' };
    this.looping.add(cardId);
    this.stopRequested.delete(cardId);
    try {
      const card = this.card(cardId);
      if (!card) return { ok: false, error: 'Card not found.' };
      if (!card.config.agentId) return this.refuse(cardId, 'Choose who does this task first.', trigger);
      if (card.goalMode && !this.deps.judge().agentId) {
        return this.refuse(cardId, 'Goal mode needs a judge. Choose one in Settings → Judge.', trigger);
      }

      let cwd: string | null | undefined;
      if (this.deps.needsFolder(card.config.agentId)) {
        const ws = await this.deps.prepareWorkspace(card);
        if (!ws.ok) return this.refuse(cardId, ws.error, trigger);
        cwd = ws.cwd;
        if (ws.worktreePath && ws.worktreePath !== card.worktreePath) {
          await this.deps.patchCard(cardId, { worktreePath: ws.worktreePath });
        }
      }

      await this.move(cardId, 'start', { blockedReason: null });
      const current = this.card(cardId) ?? card;
      return current.goalMode ? await this.runGoal(current, cwd) : await this.runOnce(current, cwd);
    } finally {
      this.looping.delete(cardId);
      this.stopRequested.delete(cardId);
      // A finished card can unblock its children or free a slot for the next one.
      void this.tick();
    }
  }

  private async runOnce(card: Card, cwd: string | null | undefined): Promise<DispatchResult> {
    const res = await this.deps.dispatcher.start(card, this.deps.getBoard().workspaceRoot, {
      role: 'worker',
      cwd,
    });
    const status = res.run?.status;
    if (status === 'succeeded') await this.move(card.id, 'succeeded');
    else if (status === 'cancelled') await this.move(card.id, 'cancelled');
    else await this.move(card.id, 'failed', { blockedReason: `Run failed: ${res.error ?? 'unknown error'}` });
    return this.summary(res);
  }

  private async stopGoal(card: Card, round: number, maxRounds: number): Promise<DispatchResult> {
    await this.setGoal(card.id, { status: 'stopped', round, maxRounds, reason: 'Stopped by the user.' });
    await this.move(card.id, 'cancelled');
    return { ok: false, error: 'Stopped by the user.' };
  }

  private async blockGoal(
    card: Card,
    round: number,
    maxRounds: number,
    reason: string,
    outcome: RunOutcome = 'goal-blocked',
  ): Promise<DispatchResult> {
    await this.setGoal(card.id, { status: 'blocked', round, maxRounds, reason });
    await this.move(card.id, outcome, { blockedReason: reason });
    return { ok: false, error: reason };
  }

  private async runGoal(card: Card, cwd: string | null | undefined): Promise<DispatchResult> {
    const judge = this.deps.judge();
    const maxRounds = judge.maxRounds;
    const root = (): string | null => this.deps.getBoard().workspaceRoot;

    let sessionId: string | null = null;
    let report = '';
    let feedback = '';
    let judgeFailures = 0;

    for (let round = 1; round <= maxRounds; round++) {
      if (this.stopRequested.has(card.id)) return this.stopGoal(card, round - 1, maxRounds);
      await this.setGoal(card.id, { status: 'running', round, maxRounds, reason: round === 1 ? null : feedback });
      const current = this.card(card.id) ?? card;

      // ---- the worker's round
      const worker = await this.deps.dispatcher.start(current, root(), {
        role: 'worker',
        round,
        cwd,
        ...(round === 1
          ? {}
          : {
              prompt: buildContinuationPrompt({
                card: current,
                feedback,
                round,
                maxRounds,
                resumed: Boolean(sessionId),
                previousReport: report,
              }),
              resumeSessionId: sessionId,
            }),
      });
      if (worker.run?.status === 'cancelled' || this.stopRequested.has(card.id)) {
        return this.stopGoal(card, round, maxRounds);
      }
      if (!worker.ok) {
        return this.blockGoal(card, round, maxRounds, `The worker's run failed: ${worker.error ?? 'unknown error'}`, 'failed');
      }
      sessionId = worker.run?.agentSessionId ?? sessionId;
      report = worker.run?.output ?? '';

      // ---- the judge's check, in the same folder, as a fresh session
      const check = await this.deps.dispatcher.start(current, root(), {
        role: 'judge',
        round,
        cwd,
        prompt: buildJudgePrompt(current, report, round, maxRounds),
        resumeSessionId: null,
        configOverride: {
          agentId: judge.agentId,
          providerId: judge.providerId,
          model: judge.model,
          effort: judge.effort,
          allowedTools: judge.allowedTools,
          allowedMcpServers: judge.allowedMcpServers,
          allowedPlugins: judge.allowedPlugins,
          allowedSkills: judge.allowedSkills,
          chatSessionId: null,
        },
      });
      if (check.run?.status === 'cancelled' || this.stopRequested.has(card.id)) {
        return this.stopGoal(card, round, maxRounds);
      }

      // Like Hermes, an unreadable or failed judgement means "keep going" — a
      // broken judge must never mark unfinished work done. Repeated failures
      // stop the loop instead of spending every round on a judge that cannot run.
      const parsed = check.ok ? parseVerdict(check.run?.output ?? '') : null;
      judgeFailures = check.ok ? 0 : judgeFailures + 1;
      if (judgeFailures >= JUDGE_FAILURE_LIMIT) {
        return this.blockGoal(card, round, maxRounds, `The judge could not run: ${check.error ?? 'unknown error'}`);
      }
      const verdict: JudgeVerdict = parsed ?? {
        verdict: 'continue',
        reason: check.ok
          ? 'The judge gave no clear verdict, so the worker keeps going.'
          : `The judge could not run (${check.error ?? 'unknown error'}), so the worker keeps going.`,
      };
      if (check.run) await this.deps.dispatcher.annotate({ cardId: card.id, run: { ...check.run, verdict } });

      if (verdict.verdict === 'done') {
        await this.setGoal(card.id, {
          status: 'done',
          round,
          maxRounds,
          reason: verdict.reason || 'The judge agreed the task is done.',
        });
        await this.move(card.id, 'goal-done', { blockedReason: null });
        return { ok: true, runId: worker.runId };
      }
      if (verdict.verdict === 'blocked') {
        return this.blockGoal(
          card,
          round,
          maxRounds,
          `The judge says this cannot be finished as written: ${verdict.reason || 'no reason given'}`,
        );
      }
      feedback = verdict.reason;
    }

    return this.blockGoal(
      card,
      maxRounds,
      maxRounds,
      `The judge was still not satisfied after ${maxRounds} round${maxRounds === 1 ? '' : 's'}. Last feedback: ${feedback || '(none)'}`,
    );
  }
}
