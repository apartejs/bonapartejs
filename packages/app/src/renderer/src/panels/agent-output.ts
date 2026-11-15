/**
 * What the agent's commands printed (task 6.6), for the terminal's agent
 * tab: gathered as the main process tells it, even while the pane is
 * closed, as one stream an emulator reads — each command announced, its
 * output with the line ends a terminal wants, its end. The end of it is
 * kept.
 */

import type { CommandOutputView } from '@aparte/bonaparte-shared';

export const AGENT_OUTPUT_CHARS = 200_000;

const DIM = '\u001b[2m';
const PLAIN = '\u001b[0m';

/** One event, as the emulator reads it. */
export function asTerminalText(event: CommandOutputView, exitCode: (code: number | null) => string): string {
  switch (event.kind) {
    case 'start':
      return `${DIM}$ ${event.command}${PLAIN}\r\n`;
    case 'data':
      return event.text.replace(/\r?\n/g, '\r\n');
    case 'exit':
      return `${DIM}${exitCode(event.code)}${PLAIN}\r\n\r\n`;
  }
}

export interface AgentOutput {
  text(): string;
  push(event: CommandOutputView): void;
  /** Each new piece, as it comes; the function returned stops listening. */
  subscribe(listener: (piece: string) => void): () => void;
}

export function createAgentOutput(exitCode: () => (code: number | null) => string, cap = AGENT_OUTPUT_CHARS): AgentOutput {
  let kept = '';
  const listeners = new Set<(piece: string) => void>();
  return {
    text: () => kept,
    push(event) {
      const piece = asTerminalText(event, exitCode());
      kept = (kept + piece).slice(-cap);
      for (const listener of listeners) listener(piece);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
