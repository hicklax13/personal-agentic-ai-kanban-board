import type { AgentAdapter, DispatchContext } from './types.js';
import { buildPrompt } from './types.js';
import { streamHttpLines } from './streaming.js';

/**
 * Ollama adapter — direct HTTP to the local daemon.
 *
 * Verified live against Ollama 0.34.1 on this machine: `/api/chat` with
 * `stream: true` returns newline-delimited JSON, one object per token batch,
 * terminated by an object with `done: true`. No authentication is involved,
 * which is why this is the one integration that cannot be blocked by a
 * credential problem.
 */

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

export const ollamaAdapter: AgentAdapter = {
  id: 'ollama',

  async run(ctx: DispatchContext) {
    const base = ctx.endpoints.ollamaBaseUrl.replace(/\/+$/, '');
    const model = ctx.card.config.model;
    if (!model) {
      return {
        ok: false,
        error: 'No model selected. Pick one of the pulled Ollama models on the card.',
        exitCode: null,
      };
    }

    const url = `${base}/api/chat`;
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: buildPrompt(ctx.card) }],
      stream: true,
    };
    // The card's "Thinking" choice maps to Ollama's `think` switch. Left unset,
    // the model decides for itself.
    if (ctx.card.config.effort === 'on') body.think = true;
    else if (ctx.card.config.effort === 'off') body.think = false;

    ctx.emit({ type: 'command', command: `POST ${url}  (model=${model})` });
    ctx.emit({ type: 'status', status: 'acknowledged', text: 'Connecting to Ollama.' });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctx.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return {
          ok: false,
          error: `Ollama returned HTTP ${res.status}. ${detail.slice(0, 300)}`,
          exitCode: null,
        };
      }

      ctx.emit({ type: 'status', status: 'running', text: 'Generating.' });

      let received = false;
      let failure: string | null = null;

      await streamHttpLines(res, (line) => {
        let chunk: OllamaChunk;
        try {
          chunk = JSON.parse(line) as OllamaChunk;
        } catch {
          return;
        }
        if (chunk.error) {
          failure = chunk.error;
          return;
        }
        const delta = chunk.message?.content;
        if (delta) {
          received = true;
          ctx.emit({ type: 'text', delta });
        }
      });

      if (failure) return { ok: false, error: failure, exitCode: null };
      if (!received) {
        return { ok: false, error: 'Ollama returned an empty response.', exitCode: null };
      }
      return { ok: true, exitCode: 0 };
    } catch (err) {
      if (ctx.signal.aborted) return { ok: false, error: 'Cancelled.', exitCode: null };
      return {
        ok: false,
        error: `Could not reach Ollama at ${base}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        exitCode: null,
      };
    }
  },
};
