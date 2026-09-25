import { describe, expect, it } from 'vitest';
import { flowColumn, type FlowKey } from '../shared/flow.js';
import { addCard, findCard, moveCard } from '../shared/boardOps.js';
import { createDefaultBoard } from '../src/main/store/schema.js';
import { nextStop } from '../src/renderer/components/nextStop.js';
import { cardMatches, searchWords } from '../src/renderer/components/search.js';
import type { BoardState, Card } from '../shared/types.js';

const NOW = new Date('2026-09-25T12:00:00.000Z');

function empty(): BoardState {
  return { ...createDefaultBoard('C:/ws'), cards: [] };
}

function col(b: BoardState, key: FlowKey): string {
  return (flowColumn(b.columns, key) as { id: string }).id;
}

/** Add a card to a workflow column and return the new board plus the card. */
function put(
  b: BoardState,
  key: FlowKey,
  fields: Partial<Card> & { agentId?: string | null } = {},
): [BoardState, Card] {
  const { agentId = 'codex', ...rest } = fields;
  const id = `card-${b.cards.length + 1}`;
  const next = addCard(b, col(b, key), {
    id,
    title: rest.title ?? id,
    description: rest.description,
    priority: rest.priority,
    parentId: rest.parentId ?? null,
    scheduledAt: rest.scheduledAt ?? null,
    goalMode: rest.goalMode,
    config: { agentId, model: rest.config?.model ?? null },
  });
  return [next, findCard(next, id) as Card];
}

describe('next stop', () => {
  it('names the next station for every stop on the line', () => {
    const cases: [FlowKey, FlowKey | null][] = [
      ['triage', 'todo'],
      ['todo', 'ready'],
      ['scheduled', 'ready'],
      ['ready', 'running'],
      ['running', 'review'],
      ['blocked', 'ready'],
      ['review', 'done'],
      ['done', null],
    ];
    for (const [key, to] of cases) {
      const [b, card] = put(empty(), key);
      expect(nextStop(b, card, NOW).to, key).toBe(to);
    }
  });

  it('asks for the owner only where the card is held up on them', () => {
    const needs = (key: FlowKey, fields: Parameters<typeof put>[2] = {}): boolean => {
      const [b, card] = put(empty(), key, fields);
      return nextStop(b, card, NOW).needsYou;
    };
    expect(needs('review')).toBe(true);
    expect(needs('blocked')).toBe(true);
    expect(needs('ready', { agentId: null })).toBe(true);
    // The backlog and work the app will move on by itself do not count.
    expect(needs('triage')).toBe(false);
    expect(needs('todo')).toBe(false);
    expect(needs('ready')).toBe(false);
    expect(needs('running')).toBe(false);
    expect(needs('scheduled', { scheduledAt: '2026-09-25T13:00:00.000Z' })).toBe(false);
  });

  it('says a waiting card goes to READY when its parent is done', () => {
    const [withParent, parent] = put(empty(), 'running', { title: 'Build the API' });
    const [b, child] = put(withParent, 'todo', { parentId: parent.id });
    expect(nextStop(b, child, NOW).text).toBe('READY when “Build the API” is done');

    // Once the parent reaches DONE nothing holds the child back.
    const done = moveCard(b, parent.id, col(b, 'done'), 0);
    expect(nextStop(done, findCard(done, child.id) as Card, NOW).text).toBe('READY when you move it there');
  });

  it('sends a running Goal-mode card to DONE, not REVIEW', () => {
    const [b, card] = put(empty(), 'running', { goalMode: true });
    expect(nextStop(b, card, NOW)).toMatchObject({ to: 'done', text: 'DONE when the judge agrees' });
  });

  it('tells a READY card with nobody assigned what it is missing', () => {
    const [b, card] = put(empty(), 'ready', { agentId: null });
    expect(nextStop(b, card, NOW).text).toBe('RUNNING once you choose who does it');
  });

  it('gives a scheduled card its start time', () => {
    const [b, card] = put(empty(), 'scheduled', { scheduledAt: '2026-09-25T13:00:00.000Z' });
    expect(nextStop(b, card, NOW).text.startsWith('READY ')).toBe(true);
  });

  it('is silent off the line, in a column the owner added', () => {
    const base = empty();
    const b: BoardState = {
      ...base,
      columns: [...base.columns, { id: 'extra', title: 'Ideas for later', position: 99, wipLimit: null, accent: '#666' }],
    };
    const next = addCard(b, 'extra', { id: 'x', title: 'x' });
    expect(nextStop(next, findCard(next, 'x') as Card, NOW)).toEqual({ to: null, text: '', needsYou: false });
  });
});

describe('search', () => {
  const [, card] = put(empty(), 'todo', {
    title: 'Add OAuth sign-in',
    description: 'For the Codex adapter',
    priority: 'high',
    config: { model: 'gpt-5.4' } as Card['config'],
  });

  it('splits the box into lower-case words', () => {
    expect(searchWords('  OAuth   Codex ')).toEqual(['oauth', 'codex']);
    expect(searchWords('   ')).toEqual([]);
  });

  it('matches when every word appears somewhere on the card', () => {
    expect(cardMatches(card, searchWords('oauth'), 'OpenAI Codex')).toBe(true);
    expect(cardMatches(card, searchWords('codex adapter'), 'OpenAI Codex')).toBe(true);
    expect(cardMatches(card, searchWords('gpt-5.4 high'), 'OpenAI Codex')).toBe(true);
    expect(cardMatches(card, searchWords('openai'), 'OpenAI Codex')).toBe(true);
    expect(cardMatches(card, searchWords('oauth hermes'), 'OpenAI Codex')).toBe(false);
  });

  it('matches everything when the box is empty', () => {
    expect(cardMatches(card, [], '')).toBe(true);
  });
});
