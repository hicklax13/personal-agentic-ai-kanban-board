/**
 * How a card's provider, model and effort are settled at dispatch time.
 *
 * Shared by the main process (which applies it) and the renderer (which shows
 * the resulting defaults as hints), so the two can never disagree about what a
 * blank field will turn into.
 */
import type { CardAgentConfig, ProviderDefault } from './types.js';

/** The provider whose defaults apply to an agent's card when the card names none. */
export const AGENT_DEFAULT_PROVIDER: Record<string, string> = {
  'claude-code': 'anthropic',
  codex: 'openai',
  hermes: 'hermes',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
};

/**
 * Effort levels each agent accepts, taken from the installed tools rather than
 * remembered:
 *   claude-code — `claude --help`: --effort low|medium|high|xhigh|max
 *   codex       — `codex debug models`: supported_reasoning_levels (union across models;
 *                 each model narrows it further)
 *   hermes      — `hermes --help`: --reasoning none|minimal|low|medium|high|xhigh|max|ultra
 *   ollama      — the /api/chat `think` switch, for models reporting the "thinking" capability
 *   lmstudio    — none: no effort control this app can pass
 */
export const AGENT_EFFORTS: Record<string, string[]> = {
  'claude-code': ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  hermes: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  ollama: ['off', 'on'],
  lmstudio: [],
};

export interface RunSettings {
  providerId: string | null;
  model: string | null;
  effort: string | null;
}

/**
 * Fill a card's blank provider, model and effort from the saved defaults.
 *
 * The card always wins; a default only fills a gap. Hermes is the one agent with
 * a two-level default: its own entry (`hermes`) can nominate which of its
 * providers, model and effort to use when a card names no provider, and each
 * Hermes provider also has its own entry for cards that do name one.
 */
export function resolveRunSettings(
  config: CardAgentConfig,
  defaults: Record<string, ProviderDefault>,
): RunSettings {
  const agentId = config.agentId ?? '';

  if (agentId === 'hermes') {
    const hermes = defaults.hermes;
    const providerId = config.providerId ?? hermes?.provider ?? null;
    const provider = providerId ? defaults[providerId] : undefined;
    const usingHermesDefault = !config.providerId;
    return {
      providerId,
      model: config.model ?? (usingHermesDefault ? hermes?.model : null) ?? provider?.model ?? null,
      effort:
        config.effort ??
        (usingHermesDefault ? hermes?.effort : null) ??
        provider?.effort ??
        hermes?.effort ??
        null,
    };
  }

  const key = config.providerId ?? AGENT_DEFAULT_PROVIDER[agentId] ?? null;
  const d = key ? defaults[key] : undefined;
  return {
    providerId: config.providerId,
    model: config.model ?? d?.model ?? null,
    effort: config.effort ?? d?.effort ?? null,
  };
}

/**
 * Whether an agent accepts an effort value. A default saved for one agent can
 * reach another (a Codex card pointed at the Ollama provider, say), so every
 * adapter checks before passing a value on rather than sending one the CLI
 * would reject.
 */
export function effortAccepted(agentId: string, effort: string | null): effort is string {
  return Boolean(effort) && (AGENT_EFFORTS[agentId] ?? []).includes(effort as string);
}
