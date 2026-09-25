import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface ExecResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

/**
 * Run a command and capture its output, never throwing.
 *
 * Discovery probes a dozen binaries at startup and any of them may be missing,
 * hung, or broken. Returning a result object instead of rejecting lets the
 * scanner treat "this tool is unavailable" as ordinary data rather than an
 * exception that has to be caught at every call site.
 */
export function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ExecResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        windowsHide: true,
        // `shell: false` keeps arguments out of a command interpreter, so a
        // prompt containing quotes or && can never become shell syntax.
        shell: false,
        // Nothing probed here reads stdin, and handing a CLI a pipe it will
        // never receive data on is a reliable way to make it wait forever.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({
        ok: false,
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    const finish = (code: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: !error && !timedOut && code === 0, code, stdout, stderr, timedOut, error });
    };

    child.on('error', (err) => finish(null, err.message));
    child.on('close', (code) => finish(code));
  });
}

async function isFile(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve an executable the way a shell would, plus an explicit list of extra
 * directories to check.
 *
 * Windows needs the PATHEXT dance because `claude` on disk is really
 * `claude.cmd` or `claude.exe`, and the Git-Bash PATH a developer sees is not
 * the PATH an Electron app inherits.
 */
export async function which(
  name: string,
  extraDirs: string[] = [],
): Promise<string | null> {
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const dirs = [...extraDirs, ...pathDirs];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (await isFile(candidate)) return candidate;
    }
    // Also accept an extension-less file (how Git Bash shims usually appear).
    const bare = join(dir, name);
    if (await isFile(bare)) return bare;
  }
  return null;
}

/**
 * Find a binary whose parent directory name is unknown at build time.
 *
 * Codex installs itself under a content-hashed folder
 * (`.../Codex/bin/<hash>/codex.exe`) that changes on every update, so the only
 * correct way to locate it is to look, not to remember.
 */
export async function findInHashedDir(
  parentDir: string,
  fileName: string,
): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(parentDir);
  } catch {
    return null;
  }
  const found: { path: string; mtime: number }[] = [];
  for (const entry of entries) {
    const candidate = join(parentDir, entry, fileName);
    try {
      const st = await fs.stat(candidate);
      if (st.isFile()) found.push({ path: candidate, mtime: st.mtimeMs });
    } catch {
      /* not this one */
    }
  }
  if (found.length === 0) return null;
  // Newest wins: an update leaves the old hashed dir behind.
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0].path;
}
