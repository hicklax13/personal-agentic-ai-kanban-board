import type { Card } from '@shared/types';

/** The search box's words, lower-cased; no words matches every card. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every word appears in the card's title, description, model, assignee or priority. */
export function cardMatches(card: Card, words: string[], agentName: string): boolean {
  if (words.length === 0) return true;
  const text = [
    card.title,
    card.description,
    card.config.model ?? '',
    card.config.providerId ?? '',
    agentName,
    card.priority,
  ]
    .join(' ')
    .toLowerCase();
  return words.every((w) => text.includes(w));
}
