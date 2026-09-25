import type { AgentAdapter } from './types.js';
import { claudeCodeAdapter } from './claudeCode.js';
import { codexAdapter } from './codex.js';
import { hermesAdapter } from './hermes.js';
import { lmStudioAdapter } from './lmstudio.js';
import { ollamaAdapter } from './ollama.js';

/** Every agent the board can dispatch to, keyed by the id used in discovery. */
const adapters = new Map<string, AgentAdapter>([
  [claudeCodeAdapter.id, claudeCodeAdapter],
  [codexAdapter.id, codexAdapter],
  [hermesAdapter.id, hermesAdapter],
  [ollamaAdapter.id, ollamaAdapter],
  [lmStudioAdapter.id, lmStudioAdapter],
]);

export function getAdapter(agentId: string): AgentAdapter | null {
  return adapters.get(agentId) ?? null;
}

export function adapterIds(): string[] {
  return [...adapters.keys()];
}
