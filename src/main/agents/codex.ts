import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Card } from '@shared/types';
import type { AgentAdapter, CommandPlan, DispatchContext } from './types.js';
import { buildPrompt, renderCommand } from './types.js';
import { spawnStreaming } from './streaming.js';
import { buildAgentEnv } from './credentials.js';

/**
 * Codex adapter — `codex exec --json`, a JSONL event stream.
 *
 * The event shapes handled below were captured from a real run of the installed
 * codex-cli 0.155.0-alpha.9.2 on this machine, including the failure path, so
 * the parser is written against observed output rather than documentation.
 */

export interface CodexOptions {
  binaryPath: string;
  card: Card;
  workspaceRoot: string | null;
  resumeSessionId: string | null;
  /** File the CLI writes the final assistant message to. */
  lastMessagePath: string;
  /** When the card targets a local provider, route Codex at it instead of the API. */
  localProvider: 'ollama' | 'lmstudio' | null;
}

export function buildCodexCommand(opts: CodexOptions): CommandPlan {
  const { card } = opts;
  const args: string[] = ['exec'];

  // `exec resume <id>` continues an existing thread; the prompt follows either way.
  if (opts.resumeSessionId) args.push('resume', opts.resumeSessionId);

  args.push(buildPrompt(card));
  args.push('--json');
  args.push('--output-last-message', opts.lastMessagePath);

  // Codex refuses to run outside a Git repository unless told otherwise, and a
  // Kanban workspace is frequently just a folder.
  args.push('--skip-git-repo-check');

  // Full autonomy, by the owner's explicit choice: no sandbox and no approval
  // prompts. A board run is unattended, so any prompt would stall it, and the
  // read-only sandbox would stop Codex editing files at all. This flag replaces
  // `--sandbox`; the two are not combined.
  args.push('--dangerously-bypass-approvals-and-sandbox');

  if (card.config.model) args.push('-m', card.config.model);
  if (opts.localProvider) args.push('--oss', '--local-provider', opts.localProvider);

  const cwd = card.config.workingDirectory || opts.workspaceRoot;
  if (cwd) args.push('-C', cwd);

  return { command: opts.binaryPath, args, display: renderCommand(opts.binaryPath, args) };
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  item?: {
    id?: string;
    type?: string;
    text?: string;
    message?: string;
    content?: string;
    name?: string;
  };
}

/** Pull displayable text out of an item, whose payload key varies by item type. */
export function itemText(item: NonNullable<CodexEvent['item']>): string | null {
  return item.text ?? item.message ?? item.content ?? null;
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',

  async run(ctx: DispatchContext) {
    if (!ctx.agent.binaryPath) {
      return { ok: false, error: 'Codex binary not found.', exitCode: null };
    }

    const lastMessagePath = join(tmpdir(), `agent-kanban-codex-${randomUUID()}.txt`);
    const localProvider =
      ctx.card.config.providerId === 'ollama'
        ? 'ollama'
        : ctx.card.config.providerId === 'lmstudio'
          ? 'lmstudio'
          : null;

    const plan = buildCodexCommand({
      binaryPath: ctx.agent.binaryPath,
      card: ctx.card,
      workspaceRoot: ctx.workspaceRoot,
      resumeSessionId: ctx.session?.nativeSessionId ?? null,
      lastMessagePath,
      localProvider,
    });

    ctx.emit({ type: 'command', command: plan.display });
    ctx.emit({ type: 'status', status: 'running', text: 'Codex started.' });

    const env = await buildAgentEnv('codex', ctx.secrets);

    let reportedError: string | null = null;
    let streamedText = '';

    const handleLine = (line: string): void => {
      let ev: CodexEvent;
      try {
        ev = JSON.parse(line) as CodexEvent;
      } catch {
        ctx.emit({ type: 'event', kind: 'info', text: line });
        return;
      }

      switch (ev.type) {
        case 'thread.started':
          if (ev.thread_id) ctx.emit({ type: 'session', id: ev.thread_id });
          ctx.emit({ type: 'status', status: 'acknowledged', text: 'Thread started.' });
          break;

        case 'turn.started':
          ctx.emit({ type: 'status', status: 'running', text: 'Turn started.' });
          break;

        case 'item.started':
        case 'item.updated':
        case 'item.completed': {
          const item = ev.item;
          if (!item) break;
          const text = itemText(item);
          if (item.type === 'error') {
            reportedError = text ?? 'Codex reported an error.';
            ctx.emit({ type: 'event', kind: 'error', text: reportedError });
          } else if (item.type === 'agent_message' || item.type === 'assistant_message') {
            if (ev.type === 'item.completed' && text) {
              streamedText += text;
              ctx.emit({ type: 'text', delta: text });
            }
          } else if (text) {
            ctx.emit({ type: 'event', kind: 'tool', text: `${item.type ?? 'item'}: ${truncate(text)}` });
          } else if (item.type) {
            ctx.emit({ type: 'event', kind: 'tool', text: item.type });
          }
          break;
        }

        case 'turn.completed':
          ctx.emit({ type: 'status', status: 'running', text: 'Turn completed.' });
          break;

        case 'turn.failed':
          reportedError = ev.error?.message ?? 'Codex turn failed.';
          break;

        case 'error':
          reportedError = ev.message ?? 'Codex reported an error.';
          break;

        default:
          break;
      }
    };

    const result = await spawnStreaming({
      command: plan.command,
      args: plan.args,
      cwd: ctx.card.config.workingDirectory || ctx.workspaceRoot || undefined,
      env,
      signal: ctx.signal,
      emit: ctx.emit,
      onStdoutLine: handleLine,
      // No stdin: `codex exec` appends piped stdin to the prompt as a <stdin>
      // block, and the prompt is already passed as an argument.
    });

    // The --output-last-message file is the authoritative final answer; the
    // event stream is best-effort. Prefer the file when the two disagree.
    let finalMessage: string | null = null;
    try {
      finalMessage = (await fs.readFile(lastMessagePath, 'utf8')).trim() || null;
    } catch {
      finalMessage = null;
    } finally {
      await fs.rm(lastMessagePath, { force: true }).catch(() => undefined);
    }

    if (reportedError) {
      return { ok: false, error: reportedError, exitCode: result.exitCode };
    }
    if (finalMessage && finalMessage !== streamedText.trim()) {
      ctx.emit({ type: 'text-final', text: finalMessage });
    }
    if (!finalMessage && !streamedText) {
      return {
        ok: false,
        error: 'Codex produced no output. Check `codex login` and your plan quota.',
        exitCode: result.exitCode,
      };
    }
    return result;
  },
};

function truncate(s: string, n = 160): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
