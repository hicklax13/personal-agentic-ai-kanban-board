import type {
  Card,
  ChatSession,
  DiscoveredAgent,
  EndpointSettings,
  RunEvent,
  RunStatus,
  SecretKey,
} from '@shared/types';

/** Everything an adapter emits back to the dispatcher as a run progresses. */
export type AdapterEvent =
  | { type: 'status'; status: RunStatus; text?: string }
  /** A chunk of assistant text to append to the card's output. */
  | { type: 'text'; delta: string }
  /** Replace the accumulated text outright (used when only a final answer exists). */
  | { type: 'text-final'; text: string }
  | { type: 'event'; kind: RunEvent['kind']; text: string }
  /** The agent's own session id, captured so the chat thread can be resumed. */
  | { type: 'session'; id: string }
  /** The exact argv, recorded on the run so it is reproducible. */
  | { type: 'command'; command: string };

export interface SecretReader {
  get(key: SecretKey): Promise<string | null>;
}

export interface DispatchContext {
  card: Card;
  agent: DiscoveredAgent;
  workspaceRoot: string | null;
  session: ChatSession | null;
  endpoints: EndpointSettings;
  secrets: SecretReader;
  emit(event: AdapterEvent): void;
  signal: AbortSignal;
}

export interface AdapterResult {
  ok: boolean;
  error?: string;
  exitCode: number | null;
}

export interface AgentAdapter {
  id: string;
  run(ctx: DispatchContext): Promise<AdapterResult>;
}

/** Shape returned by every pure argv builder, so tests can assert on it directly. */
export interface CommandPlan {
  command: string;
  args: string[];
  /** Rendered for display on the card. Quoted so it can be pasted into a shell. */
  display: string;
}

export function renderCommand(command: string, args: string[]): string {
  const quote = (s: string): string =>
    /[\s"'`$&|<>()]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
  return [command, ...args].map(quote).join(' ');
}

/**
 * Compose the text actually sent to the agent.
 *
 * The card's description is included as context above the instruction because a
 * card title plus a bare prompt usually loses the detail a human wrote in the
 * body — and re-typing it into the prompt field is exactly the friction this
 * board is meant to remove.
 */
export function buildPrompt(card: Card): string {
  const parts: string[] = [];
  if (card.description.trim()) {
    parts.push(`# Context: ${card.title}\n\n${card.description.trim()}`);
  }
  const instruction = card.config.taskPrompt.trim();
  parts.push(instruction || card.title);
  return parts.join('\n\n---\n\n');
}
