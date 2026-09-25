import type { Card } from '@shared/types';
import type { AgentAdapter, CommandPlan, DispatchContext } from './types.js';
import { buildPrompt, renderCommand } from './types.js';
import { spawnStreaming } from './streaming.js';
import { buildAgentEnv } from './credentials.js';

/**
 * Hermes adapter — `hermes -z`, one-shot mode.
 *
 * `-z` prints only the final response text: no banner, no spinner, no tool
 * previews. That makes it trivially parseable but means there is nothing to
 * stream, which is why the discovery record sets `supportsStreaming: false`
 * for this agent and the card shows a spinner rather than live text.
 *
 * Hermes is the one agent here with a first-class `--skills` flag, so skill
 * selections are genuinely enforced rather than merely recorded.
 */

export interface HermesOptions {
  binaryPath: string;
  card: Card;
  workspaceRoot: string | null;
  resumeSessionId: string | null;
}

export function buildHermesCommand(opts: HermesOptions): CommandPlan {
  const { card } = opts;
  const args: string[] = ['-z', buildPrompt(card)];

  // Full autonomy, by the owner's explicit choice. --yolo skips the approval
  // prompt for dangerous commands; --accept-hooks approves unseen config hooks.
  // A one-shot run has no terminal to answer either prompt, so without them a
  // run would stall or have the action refused.
  args.push('--yolo', '--accept-hooks');

  if (card.config.model) args.push('-m', card.config.model);

  // Provider ids are stored namespaced (`hermes:deepseek`) so they cannot
  // collide with the top-level providers; strip the prefix before passing on.
  if (card.config.providerId) {
    const provider = card.config.providerId.startsWith('hermes:')
      ? card.config.providerId.slice('hermes:'.length)
      : card.config.providerId;
    args.push('--provider', provider);
  }

  // Tool ids are namespaced per agent in discovery; Hermes wants bare toolset names.
  const toolsets = card.config.allowedTools
    .map((t) => (t.startsWith('hermes:') ? t.slice('hermes:'.length) : t))
    .filter(Boolean);
  if (toolsets.length > 0) args.push('-t', toolsets.join(','));

  const skills = card.config.allowedSkills
    .map((s) => (s.includes(':') ? s.slice(s.lastIndexOf(':') + 1) : s))
    .filter(Boolean);
  if (skills.length > 0) args.push('--skills', skills.join(','));

  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);

  const cwd = card.config.workingDirectory || opts.workspaceRoot;
  if (cwd) args.push('--in', cwd);

  return { command: opts.binaryPath, args, display: renderCommand(opts.binaryPath, args) };
}

export const hermesAdapter: AgentAdapter = {
  id: 'hermes',

  async run(ctx: DispatchContext) {
    if (!ctx.agent.binaryPath) {
      return { ok: false, error: 'Hermes binary not found.', exitCode: null };
    }

    const plan = buildHermesCommand({
      binaryPath: ctx.agent.binaryPath,
      card: ctx.card,
      workspaceRoot: ctx.workspaceRoot,
      resumeSessionId: ctx.session?.nativeSessionId ?? null,
    });

    ctx.emit({ type: 'command', command: plan.display });
    ctx.emit({ type: 'status', status: 'running', text: 'Hermes one-shot started.' });

    // Every stored provider key goes along; Hermes keeps its own copy of any key
    // it already has, because it loads its .env over inherited variables.
    const env = await buildAgentEnv('hermes', ctx.secrets);

    const lines: string[] = [];

    const result = await spawnStreaming({
      command: plan.command,
      args: plan.args,
      cwd: ctx.card.config.workingDirectory || ctx.workspaceRoot || undefined,
      env,
      signal: ctx.signal,
      emit: ctx.emit,
      onStdoutLine: (line) => {
        lines.push(line);
        // -z emits plain text, so append as it arrives. It arrives in one burst
        // at the end, but treating it as a stream keeps the UI path identical.
        ctx.emit({ type: 'text', delta: `${line}\n` });
      },
    });

    const text = lines.join('\n').trim();

    // Hermes exits 0 even when the agent itself failed, printing the reason on
    // stderr ("hermes -z: agent failed: ..."). Empty stdout is the tell.
    if (!text) {
      return {
        ok: false,
        error:
          result.error ??
          'Hermes produced no output. Run `hermes doctor` to check provider configuration.',
        exitCode: result.exitCode,
      };
    }

    return result;
  },
};
