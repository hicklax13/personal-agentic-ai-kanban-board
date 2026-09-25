import type { SecretKey } from '@shared/types';
import type { SecretReader } from './types.js';

/**
 * Which stored credentials each agent receives, as environment variables named
 * exactly like the secret.
 *
 * Only agents that read keys from their environment appear here. Hermes gets
 * every provider key because it is the one multi-provider agent; Claude Code and
 * Codex get their own provider's key only. Both of those ignored a test key while
 * signed in to an account, so a stored key does not switch a signed-in account
 * over to pay-per-use API billing. The LM Studio key is sent as an HTTP header by
 * its own adapter instead.
 *
 * Hermes loads its own `.env` over anything inherited, so a key Hermes already
 * holds wins over the board's copy. Keys it does not hold are honoured: its env
 * loader documents shell exports as a supported way to supply credentials.
 */
export const AGENT_SECRET_ENV: Record<string, SecretKey[]> = {
  'claude-code': ['ANTHROPIC_API_KEY'],
  codex: ['OPENAI_API_KEY'],
  hermes: [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'DEEPSEEK_API_KEY',
    'XAI_API_KEY',
    'DEEPINFRA_API_KEY',
    'COMMANDCODE_API_KEY',
    'XIAOMI_API_KEY',
    'OLLAMA_API_KEY',
  ],
};

/**
 * Build the child environment for an agent: the inherited environment plus each
 * stored credential that agent reads. A key with no stored value is left exactly
 * as inherited, so a board with no keys behaves as if this layer did not exist.
 */
export async function buildAgentEnv(
  agentId: string,
  secrets: SecretReader,
  base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of AGENT_SECRET_ENV[agentId] ?? []) {
    const value = await secrets.get(key);
    if (value) env[key] = value;
  }
  return env;
}
