import type { AgentAdapter, DispatchContext } from './types.js';

/**
 * Adapter for an integration that exists as a product but has no usable local
 * interface — currently ChatGPT Desktop.
 *
 * It is a real registered adapter rather than a missing entry so the agent
 * still appears in the picker with a visible "Not Connected" badge. Dispatch
 * fails immediately with the reason and the supported alternative, which is
 * strictly more useful than the agent silently not being offered at all.
 *
 * To activate a stub: give the corresponding entry in `discovery/agents.ts` a
 * real transport, then replace this adapter in the registry with one that
 * speaks it.
 */
export function createNotConnectedAdapter(id: string, reason: string): AgentAdapter {
  return {
    id,
    async run(ctx: DispatchContext) {
      ctx.emit({ type: 'event', kind: 'error', text: reason });
      ctx.emit({ type: 'status', status: 'failed', text: 'Not connected.' });
      return { ok: false, error: reason, exitCode: null };
    },
  };
}

export const CHATGPT_DESKTOP_REASON =
  'ChatGPT Desktop is not connected. It ships no documented local socket, REST endpoint ' +
  'or CLI that a third-party app may drive, so there is nothing to dispatch to. ' +
  'Use the Codex agent to reach the same OpenAI account.';
