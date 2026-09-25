import { spawn } from 'node:child_process';
import type { AdapterEvent, AdapterResult } from './types.js';

/**
 * Split an incoming byte stream into complete lines.
 *
 * Both Claude Code and Codex emit newline-delimited JSON, and a chunk boundary
 * can land in the middle of a JSON object. Buffering the tail until a newline
 * arrives is what stops the parser choking on half an object under load.
 */
export class LineBuffer {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    // The final element is either an incomplete line or an empty string.
    this.buffer = lines.pop() ?? '';
    return lines.filter((l) => l.length > 0);
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest ? [rest] : [];
  }
}

export interface SpawnStreamOptions {
  command: string;
  args: string[];
  cwd: string | undefined;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  emit: (event: AdapterEvent) => void;
  /** Called for each complete stdout line. */
  onStdoutLine: (line: string) => void;
  /**
   * Text to write to the child's stdin. Leave undefined to give the child no
   * stdin at all, which is what these agents expect — see below.
   */
  stdin?: string;
  timeoutMs?: number;
}

/**
 * Pick the most useful stderr line to report as the failure reason.
 *
 * Taking the last line is tempting and wrong: these CLIs run shutdown hooks
 * that frequently log their own unrelated failures after the real error, so the
 * last line is often a red herring. The first line that actually looks like an
 * error is a much better summary — and the full stderr is on the run's event
 * log either way.
 */
export function pickErrorLine(lines: string[]): string | null {
  if (lines.length === 0) return null;
  const signal = /\b(error|failed|cannot|denied|unauthori[sz]ed|expired|limit|invalid)\b/i;
  return lines.find((l) => signal.test(l)) ?? lines[lines.length - 1];
}

/**
 * Spawn a child process and stream its output line by line.
 *
 * `shell: false` throughout: a task prompt is arbitrary user text and may
 * contain quotes, backticks or `&&`. Passing argv directly means the OS hands
 * the string to the program as one argument and no shell ever parses it.
 */
export function spawnStreaming(options: SpawnStreamOptions): Promise<AdapterResult> {
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;

  const wantsStdin = typeof options.stdin === 'string' && options.stdin.length > 0;

  return new Promise<AdapterResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    const stderrLines: string[] = [];

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
      /**
       * stdin is 'ignore' unless the child genuinely needs input.
       *
       * Handing a child an open pipe and immediately closing it is the obvious
       * thing to do and it deadlocks Hermes on Windows: the process blocks
       * during startup having burned 0.015s of CPU and never recovers. Verified
       * by experiment — a closed-pipe stdin times out after 150s where an
       * ignored stdin completes in 77s with the right answer. 'ignore' attaches
       * the null device, which every one of these CLIs handles correctly.
       */
      stdio: [wantsStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    const stdoutBuf = new LineBuffer();
    const stderrBuf = new LineBuffer();

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const onAbort = (): void => {
      child.kill();
    };
    options.signal.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (d: Buffer) => {
      for (const line of stdoutBuf.push(d.toString())) options.onStdoutLine(line);
    });

    const takeStderr = (line: string): void => {
      // Keep a bounded history for the error summary, and surface every line as
      // an event so a stalled run still shows what the agent is complaining about.
      stderrLines.push(line);
      if (stderrLines.length > 30) stderrLines.shift();
      options.emit({ type: 'event', kind: 'stderr', text: line });
    };

    child.stderr?.on('data', (d: Buffer) => {
      for (const line of stderrBuf.push(d.toString())) takeStderr(line);
    });

    const finish = (code: number | null, error?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);

      for (const line of stdoutBuf.flush()) options.onStdoutLine(line);
      for (const line of stderrBuf.flush()) takeStderr(line);

      if (options.signal.aborted) {
        resolve({ ok: false, error: 'Cancelled.', exitCode: code });
        return;
      }
      if (timedOut) {
        resolve({
          ok: false,
          error: `Timed out after ${Math.round(timeoutMs / 1000)}s.`,
          exitCode: code,
        });
        return;
      }
      if (error) {
        resolve({ ok: false, error, exitCode: code });
        return;
      }
      if (code !== 0) {
        resolve({
          ok: false,
          error: pickErrorLine(stderrLines) ?? `Process exited with code ${code}.`,
          exitCode: code,
        });
        return;
      }
      resolve({ ok: true, exitCode: code });
    };

    child.on('error', (err) => finish(null, err.message));
    child.on('close', (code) => finish(code));

    if (wantsStdin) child.stdin?.end(options.stdin);
  });
}

/**
 * Stream a fetch response body line by line.
 *
 * Used for the two HTTP integrations: Ollama emits newline-delimited JSON and
 * LM Studio emits SSE, and both are consumed the same way once framed.
 */
export async function streamHttpLines(
  response: Response,
  onLine: (line: string) => void,
): Promise<void> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const buf = new LineBuffer();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of buf.push(decoder.decode(value, { stream: true }))) onLine(line);
  }
  for (const line of buf.flush()) onLine(line);
}
