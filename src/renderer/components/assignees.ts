import type { AppSettings, DiscoveredProvider, DiscoveryReport } from '@shared/types';
import { CREDENTIALS } from '@shared/types';
import { AGENT_DEFAULT_PROVIDER } from '@shared/runSettings';

/**
 * "Who does this task" — the same three groups as Settings: an account you
 * signed in to, a connection to a local agent or server, or an API key. Each
 * choice is an agent plus the provider it should use.
 */

export type AssigneeGroup = 'Accounts' | 'Connections' | 'API keys';

export const ASSIGNEE_GROUPS: AssigneeGroup[] = ['Accounts', 'Connections', 'API keys'];

export interface AssigneeOption {
  /** `${agentId}|${providerId}` — one per choice. */
  key: string;
  group: AssigneeGroup;
  label: string;
  agentId: string;
  providerId: string | null;
  /** A caveat shown after the label, e.g. "no key saved". */
  note: string | null;
  /** The agent behind it is not installed or not reachable. */
  unavailable: boolean;
}

export const assigneeKey = (agentId: string | null, providerId: string | null): string =>
  `${agentId ?? ''}|${providerId ?? ''}`;

/**
 * The option a saved agent + provider corresponds to. A card that names no
 * provider uses its agent's own (Claude Code → Anthropic, Codex → OpenAI), so
 * it matches the account row instead of showing up as unknown. Hermes with no
 * provider is its own choice: "use Hermes's default".
 */
export function keyForConfig(agentId: string | null, providerId: string | null): string {
  if (!agentId) return '';
  if (!providerId && agentId !== 'hermes' && AGENT_DEFAULT_PROVIDER[agentId]) {
    return assigneeKey(agentId, AGENT_DEFAULT_PROVIDER[agentId]);
  }
  return assigneeKey(agentId, providerId);
}

export function buildAssignees(
  discovery: DiscoveryReport | null,
  settings: AppSettings | null,
): AssigneeOption[] {
  const agents = new Map((discovery?.agents ?? []).map((a) => [a.id, a] as const));
  const out: AssigneeOption[] = [];

  const add = (opt: Omit<AssigneeOption, 'key' | 'unavailable'>): void => {
    const agent = agents.get(opt.agentId);
    if (!agent) return; // only agents that exist on this machine
    const key = assigneeKey(opt.agentId, opt.providerId);
    if (out.some((o) => o.key === key)) return;
    out.push({ ...opt, key, unavailable: agent.availability === 'unavailable' });
  };

  add({ group: 'Accounts', label: 'OpenAI (ChatGPT) · Codex', agentId: 'codex', providerId: 'openai', note: null });
  add({
    group: 'Accounts',
    label: 'Anthropic (Claude) · Claude Code',
    agentId: 'claude-code',
    providerId: 'anthropic',
    note: null,
  });

  add({
    group: 'Connections',
    label: 'Hermes Agent · its default provider',
    agentId: 'hermes',
    providerId: null,
    note: null,
  });
  add({ group: 'Connections', label: 'Ollama (local)', agentId: 'ollama', providerId: 'ollama', note: null });
  add({ group: 'Connections', label: 'LM Studio (local)', agentId: 'lmstudio', providerId: 'lmstudio', note: null });

  // Every API key except LM Studio's reaches its provider through Hermes.
  // LM Studio's key belongs to the LM Studio connection above.
  const keyed = new Set(CREDENTIALS.map((c) => c.providerId));
  for (const cred of CREDENTIALS) {
    if (!cred.providerId.startsWith('hermes:')) continue;
    add({
      group: 'API keys',
      label: `${cred.label} · via Hermes`,
      agentId: 'hermes',
      providerId: cred.providerId,
      note: settings?.secretsPresent[cred.key] ? null : 'no key saved',
    });
  }

  // Providers configured in Hermes itself that no key above covers.
  for (const p of discovery?.providers ?? []) {
    if (p.id.startsWith('hermes:') && !keyed.has(p.id)) {
      add({ group: 'Connections', label: p.name, agentId: 'hermes', providerId: p.id, note: null });
    }
  }

  return out;
}

/**
 * The provider whose models a choice offers. "Hermes's default" offers the
 * models of the provider picked for it in Settings → Connections, if any.
 */
export function providerForChoice(
  discovery: DiscoveryReport | null,
  settings: AppSettings | null,
  agentId: string | null,
  providerId: string | null,
): DiscoveredProvider | undefined {
  if (!agentId) return undefined;
  const id =
    providerId ??
    (agentId === 'hermes' ? (settings?.providerDefaults.hermes?.provider ?? null) : AGENT_DEFAULT_PROVIDER[agentId]);
  return id ? discovery?.providers.find((p) => p.id === id) : undefined;
}
