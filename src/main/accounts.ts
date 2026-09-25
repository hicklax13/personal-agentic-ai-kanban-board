import { spawn } from 'node:child_process';
import type {
  AccountActionResult,
  AccountProvider,
  AccountStatus,
  DiscoveredAgent,
} from '@shared/types';
import { run } from './discovery/proc.js';

/**
 * Account sign-in (OAuth) for the agents that support it, performed by each
 * agent's own CLI rather than by this app.
 *
 * Both CLIs run their vendor's official browser sign-in and store the result
 * themselves. Driving their commands, instead of talking to the vendors' login
 * servers directly, means this app never sees a password or token and never
 * poses as either vendor's own client.
 */

type Parsed = { signedIn: boolean; method: string | null; detail: string };

/** `codex login status` prints one line, e.g. "Logged in using ChatGPT". */
export function parseCodexLoginStatus(output: string): Parsed {
  const line =
    output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  const m = line.match(/^Logged in using (.+?)\.?$/i);
  if (m) {
    const how = m[1].trim();
    return { signedIn: true, method: /chatgpt/i.test(how) ? 'ChatGPT' : how, detail: line };
  }
  return { signedIn: false, method: null, detail: line || 'Not signed in.' };
}

/**
 * `claude auth status` prints JSON. Only the sign-in method and plan are kept;
 * the email address and organisation it also prints are never passed on.
 */
export function parseClaudeAuthStatus(output: string): Parsed {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return { signedIn: false, method: null, detail: output.trim() || 'Not signed in.' };
  }
  try {
    const status = JSON.parse(output.slice(start, end + 1)) as {
      loggedIn?: boolean;
      authMethod?: string;
      subscriptionType?: string;
    };
    if (!status.loggedIn) return { signedIn: false, method: null, detail: 'Not signed in.' };
    const how =
      status.authMethod === 'claude.ai' ? 'Claude subscription' : (status.authMethod ?? 'account');
    const plan = status.subscriptionType ? ` (${status.subscriptionType})` : '';
    return { signedIn: true, method: `${how}${plan}`, detail: `Signed in with ${how}${plan}.` };
  } catch {
    return { signedIn: false, method: null, detail: 'Could not read the sign-in status.' };
  }
}

/** The first https address in some output: the sign-in page, if the CLI printed one. */
export function findSignInUrl(text: string): string | null {
  const m = text.match(/https:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}

interface AccountCommands {
  label: string;
  via: string;
  agentId: string;
  status: string[];
  signIn: string[];
  signOut: string[];
  /** Shown if in-app sign-in fails, so there is always a way through. */
  terminalCommand: string;
  parse: (output: string) => Parsed;
}

export const ACCOUNT_COMMANDS: Record<AccountProvider, AccountCommands> = {
  openai: {
    label: 'OpenAI (ChatGPT)',
    via: 'Codex',
    agentId: 'codex',
    status: ['login', 'status'],
    signIn: ['login'],
    signOut: ['logout'],
    terminalCommand: 'codex login',
    parse: parseCodexLoginStatus,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    via: 'Claude Code',
    agentId: 'claude-code',
    status: ['auth', 'status'],
    // --claudeai picks the subscription sign-in, which is also the CLI default.
    signIn: ['auth', 'login', '--claudeai'],
    signOut: ['auth', 'logout'],
    terminalCommand: 'claude auth login',
    parse: parseClaudeAuthStatus,
  },
};

function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? '';
}

function binaryFor(provider: AccountProvider, agents: DiscoveredAgent[]): string | null {
  const agentId = ACCOUNT_COMMANDS[provider].agentId;
  return agents.find((a) => a.id === agentId)?.binaryPath ?? null;
}

export async function getAccountStatuses(agents: DiscoveredAgent[]): Promise<AccountStatus[]> {
  const providers = Object.keys(ACCOUNT_COMMANDS) as AccountProvider[];
  return Promise.all(
    providers.map(async (provider): Promise<AccountStatus> => {
      const c = ACCOUNT_COMMANDS[provider];
      const binary = binaryFor(provider, agents);
      if (!binary) {
        return {
          provider,
          label: c.label,
          via: c.via,
          available: false,
          signedIn: false,
          method: null,
          detail: `${c.via} is not installed, so there is nothing to sign in to.`,
        };
      }
      const res = await run(binary, c.status, { timeoutMs: 60_000 });
      return {
        provider,
        label: c.label,
        via: c.via,
        available: true,
        ...c.parse(`${res.stdout}\n${res.stderr}`),
      };
    }),
  );
}

/**
 * Start the CLI's own browser sign-in and wait for it to finish.
 *
 * The CLI opens the browser itself. If it also prints the sign-in address, that
 * address is passed to `onUrl` straight away, so the window can offer it as a
 * link in case the browser did not open.
 */
export function signIn(
  provider: AccountProvider,
  agents: DiscoveredAgent[],
  onUrl: (url: string) => void,
  timeoutMs = 10 * 60_000,
): Promise<AccountActionResult> {
  const c = ACCOUNT_COMMANDS[provider];
  const binary = binaryFor(provider, agents);
  if (!binary) return Promise.resolve({ ok: false, detail: `${c.via} is not installed.` });
  return runBrowserSignIn(binary, c.signIn, onUrl, c.terminalCommand, timeoutMs);
}

/**
 * Run a CLI's own browser sign-in and wait for it to finish.
 *
 * Used for both account sign-in and MCP server sign-in. The CLI opens the
 * default browser and receives the approval on its own local callback, so the
 * process must stay alive until the person finishes in the browser. If the CLI
 * prints the sign-in address, it is passed to `onUrl` so the window can offer
 * it as a link in case the browser did not open.
 */
export function runBrowserSignIn(
  binary: string,
  args: string[],
  onUrl: (url: string) => void,
  terminalCommand: string,
  timeoutMs = 10 * 60_000,
): Promise<AccountActionResult> {
  const fallback = `If this keeps failing, run \`${terminalCommand}\` in a terminal.`;

  return new Promise((resolve) => {
    let output = '';
    let announced = false;
    let settled = false;

    const child = spawn(binary, args, {
      windowsHide: true,
      shell: false,
      // stdin must be 'ignore': a closed pipe deadlocks some CLIs on Windows.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: AccountActionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        detail: `Sign-in did not finish within ${Math.round(timeoutMs / 60_000)} minutes. ${fallback}`,
      });
    }, timeoutMs);

    const take = (d: Buffer): void => {
      output += d.toString();
      if (!announced) {
        const url = findSignInUrl(output);
        if (url) {
          announced = true;
          onUrl(url);
        }
      }
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);

    child.on('error', (err) => finish({ ok: false, detail: `${err.message} ${fallback}` }));
    child.on('close', (code) =>
      finish(
        code === 0
          ? { ok: true, detail: 'Signed in.' }
          : { ok: false, detail: `${lastLine(output) || `Sign-in exited with code ${code}.`} ${fallback}` },
      ),
    );
  });
}

export async function signOut(
  provider: AccountProvider,
  agents: DiscoveredAgent[],
): Promise<AccountActionResult> {
  const c = ACCOUNT_COMMANDS[provider];
  const binary = binaryFor(provider, agents);
  if (!binary) return { ok: false, detail: `${c.via} is not installed.` };
  const res = await run(binary, c.signOut, { timeoutMs: 60_000 });
  return res.ok
    ? { ok: true, detail: 'Signed out.' }
    : {
        ok: false,
        detail: lastLine(`${res.stdout}\n${res.stderr}`) || `Sign-out exited with code ${res.code}.`,
      };
}
