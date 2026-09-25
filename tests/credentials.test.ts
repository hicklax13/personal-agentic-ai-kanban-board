import { describe, expect, it } from 'vitest';
import { AGENT_SECRET_ENV, buildAgentEnv } from '../src/main/agents/credentials.js';
import {
  ACCOUNT_COMMANDS,
  findSignInUrl,
  parseClaudeAuthStatus,
  parseCodexLoginStatus,
} from '../src/main/accounts.js';
import { CREDENTIALS, SECRET_KEYS, type SecretKey } from '../shared/types.js';

/** An in-memory stand-in for the encrypted secret store. */
function secrets(values: Partial<Record<SecretKey, string>>): { get(key: SecretKey): Promise<string | null> } {
  return { get: async (key) => values[key] ?? null };
}

// ---------------------------------------------------------------------------
// Credential catalogue
// ---------------------------------------------------------------------------

describe('CREDENTIALS', () => {
  it('lists every stored key exactly once', () => {
    expect(SECRET_KEYS).toEqual(CREDENTIALS.map((c) => c.key));
    expect(new Set(SECRET_KEYS).size).toBe(SECRET_KEYS.length);
  });

  it('uses the exact variable names from Hermes’s own provider table', () => {
    // Regression guard: these names were read out of hermes_cli/auth.py. A typo
    // here would silently send a key Hermes never looks at.
    for (const name of [
      'GOOGLE_API_KEY',
      'DEEPSEEK_API_KEY',
      'XAI_API_KEY',
      'DEEPINFRA_API_KEY',
      'COMMANDCODE_API_KEY',
      'XIAOMI_API_KEY',
      'OLLAMA_API_KEY',
    ]) {
      expect(SECRET_KEYS).toContain(name);
    }
  });

  it('gives every credential a label and a description of who uses it', () => {
    for (const c of CREDENTIALS) {
      expect(c.label.trim()).not.toBe('');
      expect(c.usedBy.trim()).not.toBe('');
    }
  });

  it('only ever routes known credentials to agents', () => {
    for (const keys of Object.values(AGENT_SECRET_ENV)) {
      for (const key of keys) expect(SECRET_KEYS).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-agent environment
// ---------------------------------------------------------------------------

describe('buildAgentEnv', () => {
  const stored = secrets({
    ANTHROPIC_API_KEY: 'anthropic-value',
    OPENAI_API_KEY: 'openai-value',
    DEEPSEEK_API_KEY: 'deepseek-value',
    OLLAMA_API_KEY: 'ollama-value',
    LM_STUDIO_API_KEY: 'lmstudio-value',
  });

  it('gives Claude Code only the Anthropic key', async () => {
    const env = await buildAgentEnv('claude-code', stored, {});
    expect(env).toEqual({ ANTHROPIC_API_KEY: 'anthropic-value' });
  });

  it('gives Codex only the OpenAI key', async () => {
    const env = await buildAgentEnv('codex', stored, {});
    expect(env).toEqual({ OPENAI_API_KEY: 'openai-value' });
  });

  it('gives Hermes every stored provider key', async () => {
    const env = await buildAgentEnv('hermes', stored, {});
    expect(env).toEqual({
      ANTHROPIC_API_KEY: 'anthropic-value',
      OPENAI_API_KEY: 'openai-value',
      DEEPSEEK_API_KEY: 'deepseek-value',
      OLLAMA_API_KEY: 'ollama-value',
    });
  });

  it('never sends the LM Studio key to a subprocess — it travels as an HTTP header', async () => {
    for (const agentId of Object.keys(AGENT_SECRET_ENV)) {
      const env = await buildAgentEnv(agentId, stored, {});
      expect(env.LM_STUDIO_API_KEY).toBeUndefined();
    }
  });

  it('leaves an inherited value alone when nothing is stored for it', async () => {
    const env = await buildAgentEnv('hermes', secrets({}), { XAI_API_KEY: 'from-shell' });
    expect(env.XAI_API_KEY).toBe('from-shell');
  });

  it('passes the rest of the environment through untouched', async () => {
    const env = await buildAgentEnv('codex', stored, { PATH: 'C:/bin', HOME: 'C:/home' });
    expect(env.PATH).toBe('C:/bin');
    expect(env.HOME).toBe('C:/home');
  });

  it('does not modify the environment it was given', async () => {
    const base = { PATH: 'C:/bin' };
    await buildAgentEnv('hermes', stored, base);
    expect(base).toEqual({ PATH: 'C:/bin' });
  });

  it('adds nothing for an agent that reads no keys', async () => {
    const env = await buildAgentEnv('ollama', stored, { PATH: 'C:/bin' });
    expect(env).toEqual({ PATH: 'C:/bin' });
  });
});

// ---------------------------------------------------------------------------
// Account sign-in status
// ---------------------------------------------------------------------------

describe('parseCodexLoginStatus', () => {
  it('reads a ChatGPT sign-in (verbatim output from codex-cli 0.155)', () => {
    expect(parseCodexLoginStatus('Logged in using ChatGPT\n')).toEqual({
      signedIn: true,
      method: 'ChatGPT',
      detail: 'Logged in using ChatGPT',
    });
  });

  it('reads an API-key sign-in', () => {
    const parsed = parseCodexLoginStatus('Logged in using an API key');
    expect(parsed.signedIn).toBe(true);
    expect(parsed.method).toBe('an API key');
  });

  it('treats anything else as signed out', () => {
    expect(parseCodexLoginStatus('Not logged in').signedIn).toBe(false);
    expect(parseCodexLoginStatus('').signedIn).toBe(false);
  });
});

describe('parseClaudeAuthStatus', () => {
  // Real field layout from `claude auth status`; the identifying values are
  // placeholders.
  const signedIn = JSON.stringify(
    {
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'person@example.com',
      orgId: '00000000-0000-0000-0000-000000000000',
      orgName: 'Example Org',
      subscriptionType: 'max',
    },
    null,
    2,
  );

  it('reads a subscription sign-in and its plan', () => {
    const parsed = parseClaudeAuthStatus(signedIn);
    expect(parsed.signedIn).toBe(true);
    expect(parsed.method).toBe('Claude subscription (max)');
  });

  it('never passes on the email address or organisation', () => {
    const parsed = JSON.stringify(parseClaudeAuthStatus(signedIn));
    expect(parsed).not.toContain('person@example.com');
    expect(parsed).not.toContain('Example Org');
    expect(parsed).not.toContain('00000000-0000');
  });

  it('reads a signed-out status', () => {
    expect(parseClaudeAuthStatus('{"loggedIn": false}').signedIn).toBe(false);
  });

  it('survives output that is not JSON', () => {
    expect(parseClaudeAuthStatus('command not found').signedIn).toBe(false);
    expect(parseClaudeAuthStatus('{ broken').signedIn).toBe(false);
  });
});

describe('findSignInUrl', () => {
  it('picks the https sign-in page and skips the local callback server', () => {
    // Illustrative text in the shape these CLIs print, not a captured transcript.
    const text =
      'Starting local login server on http://localhost:1455.\n' +
      'If your browser did not open, visit https://auth.example.com/authorize?client_id=abc&state=xyz';
    expect(findSignInUrl(text)).toBe('https://auth.example.com/authorize?client_id=abc&state=xyz');
  });

  it('returns null when no address was printed', () => {
    expect(findSignInUrl('Waiting for sign-in...')).toBeNull();
  });
});

describe('ACCOUNT_COMMANDS', () => {
  it('uses the sign-in commands each CLI documents in its own --help', () => {
    expect(ACCOUNT_COMMANDS.openai.signIn).toEqual(['login']);
    expect(ACCOUNT_COMMANDS.openai.status).toEqual(['login', 'status']);
    expect(ACCOUNT_COMMANDS.anthropic.signIn).toEqual(['auth', 'login', '--claudeai']);
    expect(ACCOUNT_COMMANDS.anthropic.status).toEqual(['auth', 'status']);
  });

  it('always has a terminal fallback to show if in-app sign-in fails', () => {
    expect(ACCOUNT_COMMANDS.openai.terminalCommand).toBe('codex login');
    expect(ACCOUNT_COMMANDS.anthropic.terminalCommand).toBe('claude auth login');
  });
});
