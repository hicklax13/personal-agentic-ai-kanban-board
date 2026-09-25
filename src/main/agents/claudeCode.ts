import type { AgentAdapter, CommandPlan, DispatchContext } from './types.js';
import { buildPrompt, renderCommand } from './types.js';
import { spawnStreaming } from './streaming.js';
import { buildAgentEnv } from './credentials.js';
import { sanitiseServerId } from '../discovery/tools.js';
import type { Card } from '@shared/types';

/**
 * Claude Code adapter — CLI subprocess with a streaming JSON protocol.
 *
 * Flags used here were all read off `claude --help` for the installed 2.1.240
 * build; nothing is assumed from memory. Notably this version has no
 * `--verbose` requirement for stream-json, and no flag for scoping skills,
 * which is why the card editor marks skills "recorded only" for this agent.
 */

export interface ClaudeOptions {
  binaryPath: string;
  card: Card;
  workspaceRoot: string | null;
  /** Native session id to resume, when the card belongs to an existing chat. */
  resumeSessionId: string | null;
}

export function buildClaudeCommand(opts: ClaudeOptions): CommandPlan {
  const { card } = opts;
  const args: string[] = ['-p', buildPrompt(card)];

  // stream-json plus partial messages is what turns this from "wait, then dump"
  // into text appearing on the card as the model produces it.
  //
  // --verbose is mandatory here, not decorative: with --print the CLI refuses
  // stream-json without it ("Error: When using --print, --output-format=stream-json
  // requires --verbose") and exits 1 before producing a single event. It is not
  // listed as a requirement in --help; this was found by running it.
  args.push('--output-format', 'stream-json', '--include-partial-messages', '--verbose');

  if (card.config.model) args.push('--model', card.config.model);

  // Tool scoping. MCP servers are expressed as tools (`mcp__<server>`), which is
  // the granularity the CLI accepts without needing each server's full config.
  const tools = [...card.config.allowedTools];
  for (const serverId of card.config.allowedMcpServers) {
    const name = `mcp__${sanitiseServerId(serverId)}`;
    if (!tools.includes(name)) tools.push(name);
  }
  if (tools.length > 0) args.push('--allowedTools', ...tools);

  // An explicit empty MCP config plus --strict-mcp-config is the documented way
  // to say "no MCP at all" — meaningfully different from "no preference".
  if (card.config.allowedMcpServers.length === 0 && card.config.allowedTools.length > 0) {
    args.push('--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }));
  }

  // Plugin scoping composes two verified facts: `--settings` accepts a JSON
  // string, and `enabledPlugins` is the settings key that gates plugins.
  if (card.config.allowedPlugins.length > 0) {
    const enabledPlugins: Record<string, boolean> = {};
    for (const id of card.config.allowedPlugins) enabledPlugins[id] = true;
    args.push('--settings', JSON.stringify({ enabledPlugins }));
  }

  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);

  const cwd = card.config.workingDirectory || opts.workspaceRoot;
  if (cwd) args.push('--add-dir', cwd);

  // Board dispatch is unattended by definition: an interactive permission
  // prompt would hang the run forever with no way to answer it.
  args.push('--permission-mode', 'bypassPermissions');

  return {
    command: opts.binaryPath,
    args,
    display: renderCommand(opts.binaryPath, args),
  };
}

/** One line of Claude Code's stream-json output. */
interface ClaudeStreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  is_error?: boolean;
  message?: {
    content?: { type?: string; text?: string; name?: string }[];
  };
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
  };
}

export const claudeCodeAdapter: AgentAdapter = {
  id: 'claude-code',

  async run(ctx: DispatchContext) {
    if (!ctx.agent.binaryPath) {
      return { ok: false, error: 'Claude Code binary not found.', exitCode: null };
    }

    const plan = buildClaudeCommand({
      binaryPath: ctx.agent.binaryPath,
      card: ctx.card,
      workspaceRoot: ctx.workspaceRoot,
      resumeSessionId: ctx.session?.nativeSessionId ?? null,
    });

    ctx.emit({ type: 'command', command: plan.display });
    ctx.emit({ type: 'status', status: 'running', text: 'Claude Code started.' });

    const env = await buildAgentEnv('claude-code', ctx.secrets);

    let sawText = false;
    let finalResult: string | null = null;
    let reportedError: string | null = null;

    const handleLine = (line: string): void => {
      let parsed: ClaudeStreamLine;
      try {
        parsed = JSON.parse(line) as ClaudeStreamLine;
      } catch {
        // Not JSON: still worth showing, it is usually a warning banner.
        ctx.emit({ type: 'event', kind: 'info', text: line });
        return;
      }

      if (parsed.session_id) ctx.emit({ type: 'session', id: parsed.session_id });

      switch (parsed.type) {
        case 'system':
          if (parsed.subtype === 'init') {
            ctx.emit({ type: 'status', status: 'acknowledged', text: 'Session initialised.' });
          }
          break;

        case 'stream_event': {
          const ev = parsed.event;
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
            sawText = true;
            ctx.emit({ type: 'text', delta: ev.delta.text });
          }
          break;
        }

        case 'assistant': {
          for (const block of parsed.message?.content ?? []) {
            if (block.type === 'tool_use' && block.name) {
              ctx.emit({ type: 'event', kind: 'tool', text: `tool: ${block.name}` });
            }
          }
          break;
        }

        case 'result': {
          if (parsed.is_error) {
            reportedError = parsed.result ?? 'Claude Code reported an error.';
          } else if (typeof parsed.result === 'string') {
            finalResult = parsed.result;
          }
          break;
        }

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
    });

    // The CLI exits 0 even when the turn failed (auth, quota), reporting the
    // problem inside the result record instead. Trusting the exit code alone
    // would show a failed run as a success.
    if (reportedError) {
      return { ok: false, error: reportedError, exitCode: result.exitCode };
    }

    if (!sawText && finalResult) {
      ctx.emit({ type: 'text-final', text: finalResult });
    }

    return result;
  },
};
