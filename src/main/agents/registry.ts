import type { AgentAdapter } from './types.js';
import { claudeCodeAdapter } from './claudeCode.js';
import { codexAdapter } from './codex.js';
import { hermesAdapter } from './hermes.js';
import { lmStudioAdapter } from './lmstudio.js';
import { ollamaAdapter } from './ollama.js';
import { CHATGPT_DESKTOP_REASON, createNotConnectedAdapter } from './notConnected.js';

/**
 * Every agent the board can dispatch to, keyed by the id used in discovery.
 *
 * Stubs are registered alongside working adapters on purpose: the UI renders
 * whatever is in this map, so a stubbed integration stays visible with its
 * reason attached instead of quietly disappearing.
 */
const adapters = new Map<string, AgentAdapter>([
  [claudeCodeAdapter.id, claudeCodeAdapter],
  [codexAdapter.id, codexAdapter],
  [hermesAdapter.id, hermesAdapter],
  [ollamaAdapter.id, ollamaAdapter],
  [lmStudioAdapter.id, lmStudioAdapter],
  ['chatgpt-desktop', createNotConnectedAdapter('chatgpt-desktop', CHATGPT_DESKTOP_REASON)],
]);

export function getAdapter(agentId: string): AgentAdapter | null {
  return adapters.get(agentId) ?? null;
}

export function adapterIds(): string[] {
  return [...adapters.keys()];
}
