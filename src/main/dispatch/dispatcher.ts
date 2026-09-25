import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type {
  AgentRun,
  BoardState,
  Card,
  CardAgentConfig,
  ChatSession,
  DiscoveredAgent,
  EndpointSettings,
  ProviderDefault,
  RunEvent,
  RunRole,
  RunUpdate,
} from '@shared/types';
import { resolveRunSettings } from '@shared/runSettings';
import type { AdapterEvent, SecretReader } from '../agents/types.js';
import { getAdapter } from '../agents/registry.js';

export interface DispatcherDeps {
  getBoard(): BoardState;
  getAgent(agentId: string): DiscoveredAgent | null;
  endpoints(): EndpointSettings;
  /** Saved default model and effort per provider, applied to blank card fields. */
  providerDefaults(): Record<string, ProviderDefault>;
  secrets: SecretReader;
  /** Push an update to the renderer. */
  publish(update: RunUpdate): void;
  /** Persist a run into the board file. */
  persist(update: RunUpdate): Promise<void>;
}

/** How one run differs from a plain "send this card to its agent". */
export interface StartOptions {
  role?: RunRole;
  round?: number;
  /** Replaces the card's own prompt — a Goal-mode continuation, or the judge's question. */
  prompt?: string;
  /** The agent session to continue, instead of the card's chat session. */
  resumeSessionId?: string | null;
  /** The folder to run in, already prepared (a worktree, say). Undefined = work it out here. */
  cwd?: string | null;
  /** Another agent's settings used on this card's behalf — how the judge runs. */
  configOverride?: Partial<CardAgentConfig>;
}

export interface StartResult {
  ok: boolean;
  runId?: string;
  error?: string;
  /** The finished run, when one was started. */
  run?: AgentRun;
}

interface ActiveRun {
  controller: AbortController;
  runId: string;
}

/**
 * Owns the lifecycle of every in-flight agent run.
 *
 * It runs a card and records the result; deciding where the card goes next is
 * the workflow's job (see the Orchestrator), so this class never moves cards.
 *
 * Updates to the renderer are throttled rather than sent per token: a fast
 * model can emit hundreds of deltas a second, and forwarding each one as its
 * own IPC message makes the UI janky for no benefit. Persistence is rarer
 * still — only on meaningful transitions — so a long run does not rewrite the
 * board file continuously.
 */
export class Dispatcher {
  private active = new Map<string, ActiveRun>();

  constructor(private readonly deps: DispatcherDeps) {}

  isRunning(cardId: string): boolean {
    return this.active.has(cardId);
  }

  runningCount(): number {
    return this.active.size;
  }

  cancel(cardId: string): boolean {
    const running = this.active.get(cardId);
    if (!running) return false;
    running.controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const [, running] of this.active) running.controller.abort();
    this.active.clear();
  }

  async start(card: Card, workspaceRoot: string | null, opts: StartOptions = {}): Promise<StartResult> {
    if (this.active.has(card.id)) {
      return { ok: false, error: 'This card already has a run in progress.' };
    }

    let runCard: Card = opts.configOverride
      ? { ...card, config: { ...card.config, ...opts.configOverride } }
      : card;
    if (opts.prompt !== undefined) {
      // The prompt is complete on its own; the description would repeat it.
      runCard = { ...runCard, description: '', config: { ...runCard.config, taskPrompt: opts.prompt } };
    }

    const agentId = runCard.config.agentId;
    if (!agentId) {
      return {
        ok: false,
        error: opts.role === 'judge' ? 'No judge is set. Choose one in Settings → Judge.' : 'No agent is assigned to this card.',
      };
    }

    const agent = this.deps.getAgent(agentId);
    if (!agent) {
      return { ok: false, error: `Agent "${agentId}" is not present in the current discovery report.` };
    }

    const adapter = getAdapter(agentId);
    if (!adapter) {
      return { ok: false, error: `No adapter is registered for agent "${agentId}".` };
    }

    // Fill any blank provider, model or effort from the saved defaults. The card
    // handed to the adapter carries the resolved values, so the run record shows
    // exactly what was used rather than "default".
    runCard = {
      ...runCard,
      config: { ...runCard.config, ...resolveRunSettings(runCard.config, this.deps.providerDefaults()) },
    };

    // Adapters run in `config.workingDirectory`, falling back to the board's
    // folder, so the resolved folder is written there for this run only.
    const cwd =
      opts.cwd !== undefined
        ? opts.cwd
        : (runCard.config.workspaceMode === 'board' ? null : runCard.config.workingDirectory) || workspaceRoot;
    runCard = { ...runCard, config: { ...runCard.config, workingDirectory: cwd } };

    // Windows refuses to start a program in a folder that does not exist, and
    // reports it as the *program* not being found — a baffling message. Check
    // the folder first so the card says what is actually wrong. HTTP agents
    // never use a folder, so they are exempt.
    if (agent.transport === 'cli-subprocess' && cwd && !existsSync(cwd)) {
      return {
        ok: false,
        error: `Working folder not found: ${cwd}. Pick a folder that exists on the card, or clear it to use the default.`,
      };
    }

    const board = this.deps.getBoard();
    const chat = board.chatSessions.find((s) => s.id === runCard.config.chatSessionId) ?? null;
    // A Goal-mode round continues the worker's own session; otherwise the
    // card's chat session (if any) decides what is resumed.
    const session: ChatSession | null =
      opts.resumeSessionId !== undefined
        ? opts.resumeSessionId
          ? {
              id: `resume:${opts.resumeSessionId}`,
              name: 'Goal loop',
              agentId,
              nativeSessionId: opts.resumeSessionId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : null
        : chat;

    const controller = new AbortController();
    const runId = randomUUID();
    this.active.set(card.id, { controller, runId });

    const run: AgentRun = {
      id: runId,
      cardId: card.id,
      agentId,
      providerId: runCard.config.providerId,
      model: runCard.config.model,
      effort: runCard.config.effort,
      status: 'queued',
      prompt: runCard.config.taskPrompt || runCard.title,
      output: '',
      events: [],
      error: null,
      exitCode: null,
      agentSessionId: session?.nativeSessionId ?? null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      command: null,
      ...(opts.role ? { role: opts.role } : {}),
      ...(opts.round ? { round: opts.round } : {}),
    };

    // Announce immediately so the tile shows "queued" before any process spawns.
    this.deps.publish({ cardId: card.id, run: { ...run } });

    let lastPublish = 0;
    let announcedStart = false;

    const pushEvent = (kind: RunEvent['kind'], text: string): void => {
      run.events.push({ at: new Date().toISOString(), kind, text });
      // Keep the transcript bounded; a chatty agent must not grow the board file
      // without limit.
      if (run.events.length > 300) run.events.splice(0, run.events.length - 300);
    };

    const publishThrottled = (force: boolean): void => {
      const now = Date.now();
      if (!force && now - lastPublish < 100) return;
      lastPublish = now;
      this.deps.publish({ cardId: card.id, run: { ...run, events: [...run.events] } });
    };

    const emit = (event: AdapterEvent): void => {
      switch (event.type) {
        case 'status': {
          run.status = event.status;
          if (event.text) pushEvent('status', event.text);
          if (!announcedStart && (event.status === 'running' || event.status === 'acknowledged')) {
            announcedStart = true;
            const update: RunUpdate = { cardId: card.id, run: { ...run, events: [...run.events] } };
            this.deps.publish(update);
            void this.deps.persist(update);
            return;
          }
          publishThrottled(true);
          break;
        }
        case 'text':
          run.output += event.delta;
          publishThrottled(false);
          break;
        case 'text-final':
          run.output = event.text;
          publishThrottled(true);
          break;
        case 'event':
          pushEvent(event.kind, event.text);
          publishThrottled(false);
          break;
        case 'session':
          run.agentSessionId = event.id;
          publishThrottled(false);
          break;
        case 'command':
          run.command = event.command;
          publishThrottled(true);
          break;
      }
    };

    try {
      const result = await adapter.run({
        card: runCard,
        agent,
        workspaceRoot,
        session,
        endpoints: this.deps.endpoints(),
        secrets: this.deps.secrets,
        emit,
        signal: controller.signal,
      });

      run.exitCode = result.exitCode;
      run.endedAt = new Date().toISOString();

      if (controller.signal.aborted) {
        run.status = 'cancelled';
        run.error = 'Cancelled by the user.';
      } else if (result.ok) {
        run.status = 'succeeded';
      } else {
        run.status = 'failed';
        run.error = result.error ?? 'The agent reported a failure.';
        pushEvent('error', run.error);
      }
    } catch (err) {
      run.status = controller.signal.aborted ? 'cancelled' : 'failed';
      run.error = controller.signal.aborted ? 'Cancelled by the user.' : err instanceof Error ? err.message : String(err);
      run.endedAt = new Date().toISOString();
      pushEvent('error', run.error);
    } finally {
      this.active.delete(card.id);
    }

    const finalUpdate: RunUpdate = { cardId: card.id, run: { ...run, events: [...run.events] } };
    this.deps.publish(finalUpdate);
    await this.deps.persist(finalUpdate);

    const finished = { ...run, events: [...run.events] };
    return run.status === 'succeeded'
      ? { ok: true, runId, run: finished }
      : { ok: false, runId, run: finished, error: run.error ?? 'Run did not succeed.' };
  }

  /** Record something on a run after it finished — the judge's verdict. */
  async annotate(update: RunUpdate): Promise<void> {
    this.deps.publish(update);
    await this.deps.persist(update);
  }
}
