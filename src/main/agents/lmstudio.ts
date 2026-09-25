import type { AgentAdapter, DispatchContext } from './types.js';
import { buildPrompt } from './types.js';
import { streamHttpLines } from './streaming.js';

/**
 * LM Studio adapter — OpenAI-compatible HTTP.
 *
 * Verified live on this machine: the server answers on the configured port but
 * rejects unauthenticated requests with HTTP 401 and an explicit message about
 * the Bearer scheme. That is why the adapter checks for a stored token first
 * and fails with a pointer to Settings rather than a bare 401.
 */

interface OpenAiChunk {
  choices?: { delta?: { content?: string } }[];
  error?: { message?: string };
}

/** Strip the SSE `data: ` framing. Returns null for keep-alives and the terminator. */
export function parseSseData(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  return payload;
}

export const lmStudioAdapter: AgentAdapter = {
  id: 'lmstudio',

  async run(ctx: DispatchContext) {
    const base = ctx.endpoints.lmStudioBaseUrl.replace(/\/+$/, '');
    const model = ctx.card.config.model;
    if (!model) {
      return { ok: false, error: 'No model selected for LM Studio.', exitCode: null };
    }

    const apiKey = await ctx.secrets.get('LM_STUDIO_API_KEY');
    if (!apiKey) {
      return {
        ok: false,
        error:
          'LM Studio requires an API token. Add LM_STUDIO_API_KEY in Settings ' +
          '(LM Studio > Developer > Authentication).',
        exitCode: null,
      };
    }

    const url = `${base}/v1/chat/completions`;
    ctx.emit({ type: 'command', command: `POST ${url}  (model=${model})` });
    ctx.emit({ type: 'status', status: 'acknowledged', text: 'Connecting to LM Studio.' });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: buildPrompt(ctx.card) }],
          stream: true,
        }),
        signal: ctx.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const hint =
          res.status === 401 || res.status === 403
            ? ' The stored LM_STUDIO_API_KEY was rejected — check it in Settings.'
            : '';
        return {
          ok: false,
          error: `LM Studio returned HTTP ${res.status}.${hint} ${detail.slice(0, 300)}`,
          exitCode: null,
        };
      }

      ctx.emit({ type: 'status', status: 'running', text: 'Generating.' });

      let received = false;
      let failure: string | null = null;

      await streamHttpLines(res, (line) => {
        const payload = parseSseData(line);
        if (!payload) return;
        let chunk: OpenAiChunk;
        try {
          chunk = JSON.parse(payload) as OpenAiChunk;
        } catch {
          return;
        }
        if (chunk.error?.message) {
          failure = chunk.error.message;
          return;
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          received = true;
          ctx.emit({ type: 'text', delta });
        }
      });

      if (failure) return { ok: false, error: failure, exitCode: null };
      if (!received) {
        return { ok: false, error: 'LM Studio returned an empty response.', exitCode: null };
      }
      return { ok: true, exitCode: 0 };
    } catch (err) {
      if (ctx.signal.aborted) return { ok: false, error: 'Cancelled.', exitCode: null };
      return {
        ok: false,
        error: `Could not reach LM Studio at ${base}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        exitCode: null,
      };
    }
  },
};
