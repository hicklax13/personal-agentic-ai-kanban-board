import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type {
  AgentRun,
  BoardState,
  Card,
  ChatSession,
  Column,
  DiscoveredAgent,
  EndpointSettings,
  ProviderDefault,
  RunEvent,
  RunUpdate,
} from '@shared/types';
import { resolveRunSettings } from '@shared/runSettings';
import type { AdapterEvent, SecretReader } from '../agents/types.js';
import { getAdapter } from '../agents/registry.js';

/**
 * Where a card should land as its run moves through phases.
 *
 * Matching on the column title first means a board the user renamed still
 * behaves sensibly, and falling back to position keeps it working on a board
 * with entirely custom column names. Returning null means "leave it alone",
 * which is the right answer rather than guessing on a two-column board.
 */
export function resolveAutoMove(
  columns: Column[],
  phase: 'start' | 'success',
  currentColumnId: string,
): string | null {
  const ordered = [...columns].sort((a, b) => a.position - b.position);
  const byTitle = (needle: string): Column | undefined =>
    ordered.find((c) => c.title.trim().toLowerCase() === needle);

  if (phase === 'start') {
    const target = byTitle('in progress') ?? ordered[1];
    if (!target || target.id === currentColumnId) return null;
    // Never drag a card backwards: a card already in Review should not jump
    // back to In Progress just because it was re-run.
    const from = ordered.findIndex((c) => c.id === currentColumnId);
    const to = ordered.findIndex((c) => c.id === target.id);
    return to > from ? target.id : null;
  }

  const target = byTitle('in review') ?? byTitle('done') ?? ordered[ordered.length - 1];
  if (!target || target.id === currentColumnId) return null;
  const from = ordered.findIndex((c) => c.id === currentColumnId);
  const to = ordered.findIndex((c) => c.id === target.id);
  return to > from ? target.id : null;
}

export interface DispatcherDeps {
  getBoard(): BoardState;
  getAgent(agentId: string): DiscoveredAgent | null;
  endpoints(): EndpointSettings;
  /** Saved default model and effort per provider, applied to blank card fields. */
  providerDefaults(): Record<string, ProviderDefault>;
  secrets: SecretReader;
  /** Push an update to the renderer. */
  publish(update: RunUpdate): void;
  /** Persist a run (and any column move) into the board file. */
  persist(update: RunUpdate): Promise<void>;
}

interface ActiveRun {
  controller: AbortController;
  runId: string;
}

/**
 * Owns the lifecycle of every in-flight agent run.
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

  async start(card: Card, workspaceRoot: string | null): Promise<{ ok: boolean; runId?: string; error?: string }> {
    if (this.active.has(card.id)) {
      return { ok: false, error: 'This card already has a run in progress.' };
    }

    const agentId = card.config.agentId;
    if (!agentId) {
      return { ok: false, error: 'No agent is assigned to this card.' };
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
    card = { ...card, config: { ...card.config, ...resolveRunSettings(card.config, this.deps.providerDefaults()) } };

    // Windows refuses to start a program in a folder that does not exist, and
    // reports it as the *program* not being found — a baffling message. Check
    // the folder first so the card says what is actually wrong. HTTP agents
    // never use a folder, so they are exempt.
    const cwd = card.config.workingDirectory || workspaceRoot;
    if (agent.transport === 'cli-subprocess' && cwd && !existsSync(cwd)) {
      return {
        ok: false,
        error: `Working folder not found: ${cwd}. Pick a folder that exists on the card, or clear it to use the default.`,
      };
    }

    const board = this.deps.getBoard();
    const session: ChatSession | null =
      board.chatSessions.find((s) => s.id === card.config.chatSessionId) ?? null;

    const controller = new AbortController();
    const runId = randomUUID();
    this.active.set(card.id, { controller, runId });

    const run: AgentRun = {
      id: runId,
      cardId: card.id,
      agentId,
      providerId: card.config.providerId,
      model: card.config.model,
      effort: card.config.effort,
      status: 'queued',
      prompt: card.config.taskPrompt || card.title,
      output: '',
      events: [],
      error: null,
      exitCode: null,
      agentSessionId: session?.nativeSessionId ?? null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      command: null,
    };

    // Announce immediately so the tile shows "queued" before any process spawns.
    this.deps.publish({ cardId: card.id, run: { ...run } });

    let lastPublish = 0;
    let movedOnStart = false;

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

          if (!movedOnStart && (event.status === 'running' || event.status === 'acknowledged')) {
            movedOnStart = true;
            const moveTo = resolveAutoMove(this.deps.getBoard().columns, 'start', card.columnId);
            const update: RunUpdate = {
              cardId: card.id,
              run: { ...run, events: [...run.events] },
              ...(moveTo ? { moveToColumnId: moveTo } : {}),
            };
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
        card,
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
      run.status = 'failed';
      run.error = err instanceof Error ? err.message : String(err);
      run.endedAt = new Date().toISOString();
      pushEvent('error', run.error);
    } finally {
      this.active.delete(card.id);
    }

    const moveTo =
      run.status === 'succeeded'
        ? resolveAutoMove(this.deps.getBoard().columns, 'success', card.columnId)
        : null;

    const finalUpdate: RunUpdate = {
      cardId: card.id,
      run: { ...run, events: [...run.events] },
      ...(moveTo ? { moveToColumnId: moveTo } : {}),
    };
    this.deps.publish(finalUpdate);
    await this.deps.persist(finalUpdate);

    return run.status === 'succeeded'
      ? { ok: true, runId }
      : { ok: false, runId, error: run.error ?? 'Run did not succeed.' };
  }
}
