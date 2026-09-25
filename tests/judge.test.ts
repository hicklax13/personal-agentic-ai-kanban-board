import { describe, expect, it } from 'vitest';
import {
  buildContinuationPrompt,
  buildJudgePrompt,
  describeTask,
  parseVerdict,
} from '../src/main/dispatch/judge.js';
import { makeCard } from '../src/main/store/schema.js';

const card = makeCard({
  columnId: 'c',
  title: 'Add a dark mode toggle',
  description: 'Done when the toggle persists across restarts and all tests pass.',
  position: 0,
  config: { taskPrompt: 'Implement it in settings.tsx.' },
});

describe('parseVerdict', () => {
  it('reads the JSON line the judge is asked to end with', () => {
    expect(parseVerdict('Checked the files.\n{"verdict": "done", "reason": "Toggle works and tests pass."}')).toEqual({
      verdict: 'done',
      reason: 'Toggle works and tests pass.',
    });
  });

  it('takes the last verdict when the judge quotes the format earlier', () => {
    const reply =
      'I will answer with {"verdict": "done", "reason": "example"} once satisfied.\n' +
      'Tests fail in settings.test.ts.\n{"verdict":"continue","reason":"Two tests fail."}';
    expect(parseVerdict(reply)).toEqual({ verdict: 'continue', reason: 'Two tests fail.' });
  });

  it('accepts verdicts in any case and the "blocked" answer', () => {
    expect(parseVerdict('{"verdict": "BLOCKED", "reason": "Needs a paid API key."}')?.verdict).toBe('blocked');
  });

  it('accepts Hermes’s older {"done": true} shape', () => {
    expect(parseVerdict('{"done": false, "reason": "missing docs"}')).toEqual({
      verdict: 'continue',
      reason: 'missing docs',
    });
  });

  it('skips the unfilled template, which is not valid JSON', () => {
    expect(parseVerdict('{"verdict": "done" | "continue" | "blocked", "reason": "..."}')).toBeNull();
  });

  it('falls back to a plain VERDICT line', () => {
    expect(parseVerdict('All good.\nVERDICT: DONE')).toEqual({ verdict: 'done', reason: '' });
    expect(parseVerdict('Verdict: not done — the README is missing')).toEqual({
      verdict: 'continue',
      reason: 'the README is missing',
    });
  });

  it('returns null when there is no decision, so the loop keeps going instead of guessing "done"', () => {
    expect(parseVerdict('It looks mostly fine to me.')).toBeNull();
    expect(parseVerdict('')).toBeNull();
    expect(parseVerdict('{"verdict": "maybe"}')).toBeNull();
  });
});

describe('judge and worker prompts', () => {
  it('describes the task from the title, description and instructions', () => {
    const text = describeTask(card);
    expect(text).toContain('Add a dark mode toggle');
    expect(text).toContain('persists across restarts');
    expect(text).toContain('Implement it in settings.tsx.');
  });

  it("gives the judge the criteria, the worker's report and the answer format", () => {
    const prompt = buildJudgePrompt(card, 'I added the toggle and ran the tests.', 2, 5);
    expect(prompt).toContain('persists across restarts');
    expect(prompt).toContain('round 2 of 5');
    expect(prompt).toContain('I added the toggle and ran the tests.');
    expect(prompt).toContain('"verdict": "done" | "continue" | "blocked"');
    expect(prompt).toMatch(/Do not create, change or delete any files/);
  });

  it('keeps only the end of a very long report', () => {
    const report = `${'x'.repeat(20_000)}THE-END`;
    const prompt = buildJudgePrompt(card, report, 1, 5);
    expect(prompt).toContain('THE-END');
    expect(prompt.length).toBeLessThan(15_000);
  });

  it('tells a resumed worker only what the judge said', () => {
    const prompt = buildContinuationPrompt({
      card,
      feedback: 'Two tests fail.',
      round: 2,
      maxRounds: 5,
      resumed: true,
      previousReport: 'I did it.',
    });
    expect(prompt).toContain('Two tests fail.');
    expect(prompt).toContain('round 1 of 5');
    expect(prompt).not.toContain('persists across restarts');
  });

  it('gives a worker that cannot resume the task and its last report again', () => {
    const prompt = buildContinuationPrompt({
      card,
      feedback: 'Two tests fail.',
      round: 3,
      maxRounds: 5,
      resumed: false,
      previousReport: 'I did it.',
    });
    expect(prompt).toContain('persists across restarts');
    expect(prompt).toContain('I did it.');
    expect(prompt).toContain('Two tests fail.');
  });
});
