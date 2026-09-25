import type { Card, JudgeVerdict } from '@shared/types';

/**
 * Goal mode's words: what the judge is asked, how its answer is read, and what
 * the worker is told next.
 *
 * Modelled on Hermes Agent's goal loop (its `/goal` command and goal-mode
 * Kanban cards): the card's title and description are the acceptance criteria,
 * the judge answers with one line of JSON — `done`, `continue` or `blocked` —
 * and `continue` sends the judge's reason back to the worker. Unlike Hermes's
 * lightweight judge, this one is a full agent running in the worker's folder,
 * so it can check the real files instead of trusting the worker's report.
 */

/** Worker output kept for the judge; the end of a report is where the result is. */
const REPORT_LIMIT = 12_000;
/** Previous report repeated to a worker that cannot resume its own session. */
const RECAP_LIMIT = 4_000;

function tail(text: string, limit: number): string {
  const t = text.trim();
  return t.length > limit ? `…(earlier text cut)…\n${t.slice(-limit)}` : t;
}

/** The task as written on the card — the acceptance criteria. */
export function describeTask(card: Pick<Card, 'title' | 'description' | 'config'>): string {
  const parts = [`# Task: ${card.title.trim() || 'Untitled'}`];
  if (card.description.trim()) parts.push(card.description.trim());
  const prompt = card.config.taskPrompt.trim();
  if (prompt && prompt !== card.title.trim()) parts.push(`## Instructions\n${prompt}`);
  return parts.join('\n\n');
}

export function buildJudgePrompt(
  card: Pick<Card, 'title' | 'description' | 'config'>,
  workerReport: string,
  round: number,
  maxRounds: number,
): string {
  return [
    'You are the judge in a goal loop. Another AI agent (the worker) is trying to finish the task ' +
      'below. Decide whether the task is completely done.',
    [
      'Rules:',
      '- The task title and description are the acceptance criteria.',
      "- Check real evidence where you can: inspect the files in this folder and run read-only checks (tests, builds, listings). Do not rely on the worker's report alone.",
      '- Do not create, change or delete any files yourself.',
      '- Answer "done" only when every requirement is met and you have seen evidence. Be conservative.',
      '- Answer "blocked" only if the task cannot be finished as written — impossible, contradictory, or needing something only a person can provide.',
      '- Otherwise answer "continue" and say exactly what is still missing, as instructions the worker can act on.',
    ].join('\n'),
    describeTask(card),
    `# Worker's report after round ${round} of ${maxRounds}\n\n${tail(workerReport, REPORT_LIMIT) || '(the worker reported nothing)'}`,
    'End your reply with exactly one line of JSON and nothing after it:\n' +
      '{"verdict": "done" | "continue" | "blocked", "reason": "<one or two sentences>"}',
  ].join('\n\n');
}

/**
 * The worker's next instruction after a `continue`.
 *
 * A worker that resumes its own session already remembers the task, so it only
 * needs the judge's feedback. One that cannot resume (an HTTP model, or a CLI
 * that reported no session) is given the task and its last report again.
 */
export function buildContinuationPrompt(opts: {
  card: Pick<Card, 'title' | 'description' | 'config'>;
  feedback: string;
  round: number;
  maxRounds: number;
  resumed: boolean;
  previousReport: string;
}): string {
  const note =
    `A judge checked your work (round ${opts.round - 1} of ${opts.maxRounds}) and says the task is ` +
    `not finished yet.\n\nJudge's feedback: ${opts.feedback.trim() || '(no details given)'}`;
  const ask =
    'Keep working until the task is fully done. When you stop, report what you did and how you ' +
    'checked it.';
  if (opts.resumed) return `${note}\n\n${ask}`;
  return [
    describeTask(opts.card),
    `## Your previous report\n\n${tail(opts.previousReport, RECAP_LIMIT) || '(empty)'}`,
    note,
    ask,
  ].join('\n\n');
}

const VERDICTS: JudgeVerdict['verdict'][] = ['done', 'continue', 'blocked'];

function fromObject(obj: unknown): JudgeVerdict | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
  if (typeof o.verdict === 'string') {
    const v = o.verdict.trim().toLowerCase() as JudgeVerdict['verdict'];
    if (VERDICTS.includes(v)) return { verdict: v, reason };
  }
  // Hermes's older shape: {"done": true|false, "reason": "..."}.
  if (typeof o.done === 'boolean') return { verdict: o.done ? 'done' : 'continue', reason };
  return null;
}

/**
 * Read the judge's decision from its reply.
 *
 * The last JSON object that carries a verdict wins, because the instruction is
 * to end with it and a judge may quote the format earlier while reasoning. A
 * plain "VERDICT: DONE" line is accepted as a fallback. Returns null when no
 * decision can be found — the caller treats that as "continue", as Hermes does,
 * so a confused judge never marks unfinished work as done.
 */
export function parseVerdict(reply: string): JudgeVerdict | null {
  const objects = reply.match(/\{[^{}]*\}/g) ?? [];
  for (let i = objects.length - 1; i >= 0; i--) {
    try {
      const found = fromObject(JSON.parse(objects[i]));
      if (found) return found;
    } catch {
      // Not JSON (a code sample, a template with placeholders) — keep looking.
    }
  }

  const lines = [...reply.matchAll(/verdict\W{0,3}\s*(done|not done|continue|blocked)\b[\s:.—-]*(.*)$/gim)];
  const last = lines[lines.length - 1];
  if (!last) return null;
  const word = last[1].toLowerCase();
  const verdict: JudgeVerdict['verdict'] = word === 'not done' ? 'continue' : (word as JudgeVerdict['verdict']);
  return { verdict, reason: last[2].trim() };
}
