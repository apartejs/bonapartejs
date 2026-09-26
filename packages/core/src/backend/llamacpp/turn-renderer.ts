/**
 * Renders a transcript into an APPEND-ONLY Qwen prompt.
 *
 * This is where, and nowhere else, the byte-stability constraint lives:
 * the render of turn N+1 extends that of turn N. The transcript is the
 * source of truth; this module only appends what it hasn't rendered yet,
 * and also knows how to replay everything from scratch (reopening a
 * conversation) deterministically.
 */

import type { ToolDefLike, TranscriptEntry } from '../types.js';
import { PromptLog, renderSystem } from '../../wire/qwen-template.js';
import {
  buildSystemPrompt,
  renderToolResults,
} from '../../wire/system-prompt.js';
import type { SystemSpec } from '../types.js';

export interface RenderedTurn {
  /** Full prompt to send to /completion. */
  prompt: string;
  /** Raw turn output, to freeze once generation is done. */
  commit(raw: string): void;
  /** The request failed: nothing of the turn is kept, the renderer stays in step with the transcript. */
  abandon(): void;
}

export class TranscriptRenderer {
  private log: PromptLog | null = null;
  private rendered = 0;
  private frozenSystemPrompt: string | null = null;
  private turnOpen = false;

  /** Frozen system prompt: rebuilding it would let it drift. */
  get systemPrompt(): string | null {
    return this.frozenSystemPrompt;
  }

  restore(systemPrompt: string): void {
    this.frozenSystemPrompt = systemPrompt;
  }

  /** The frozen system block exactly as every prompt of this conversation begins — empty until frozen. */
  get prefix(): string {
    return this.frozenSystemPrompt === null ? '' : renderSystem(this.frozenSystemPrompt);
  }

  /**
   * Prepares the next turn's prompt from the full transcript. Entries
   * already rendered are never rendered twice.
   */
  /**
   * Freezes the system prompt if it isn't already. Called when the
   * conversation opens: waiting for the first turn would leave a window
   * where a tool added in the meantime would change the prompt with no
   * delta announcing it.
   */
  ensureSystemPrompt(system: SystemSpec, tools: ToolDefLike[]): string {
    if (this.frozenSystemPrompt === null) {
      this.frozenSystemPrompt = buildSystemPrompt({
        ...(system.roots && system.roots.length > 0 ? { roots: system.roots } : {}),
        tools: tools.map((t) => ({ ...t, effect: 'read' as const })),
        ...(system.replyLanguage ? { replyLanguage: system.replyLanguage } : {}),
        ...(system.projectInstructions
          ? { projectInstructions: system.projectInstructions }
          : {}),
      });
    }
    return this.frozenSystemPrompt;
  }

  /**
   * Brings the frozen history up to the transcript, without opening a turn,
   * and returns it — what a side question (a compaction's summary) is
   * appended to.
   */
  sync(transcript: TranscriptEntry[], system: SystemSpec, tools: ToolDefLike[]): string {
    const systemPrompt = this.ensureSystemPrompt(system, tools);
    if (this.log === null) {
      this.log = new PromptLog(systemPrompt);
      this.rendered = 0;
    }
    if (this.turnOpen) {
      // Previous turn never frozen (network error): we close it empty so
      // as not to leave the log in an intermediate state.
      this.log.completeAssistantTurn('');
      this.turnOpen = false;
    }
    for (const entry of transcript.slice(this.rendered)) {
      this.append(entry);
      this.rendered += 1;
    }
    return this.log.frozen;
  }

  next(
    transcript: TranscriptEntry[],
    system: SystemSpec,
    tools: ToolDefLike[],
    options: { thinking?: boolean } = {},
  ): RenderedTurn {
    this.sync(transcript, system, tools);
    const log = this.log as PromptLog;
    const prompt = log.beginAssistantTurn({
      thinking: options.thinking ?? false,
    });
    this.turnOpen = true;

    return {
      prompt,
      commit: (raw: string) => {
        this.log?.completeAssistantTurn(raw);
        this.turnOpen = false;
        // The assistant turn that will follow in the transcript is already rendered.
        this.rendered += 1;
      },
      abandon: () => {
        this.log?.abandonAssistantTurn();
        this.turnOpen = false;
      },
    };
  }

  private append(entry: TranscriptEntry): void {
    const log = this.log;
    if (!log) return;
    switch (entry.role) {
      case 'user':
      case 'service':
        log.appendUser(entry.text);
        break;
      case 'tool_results':
        log.appendUser(renderToolResults(entry.results));
        break;
      case 'assistant':
        // Replay (reopening): the turn is reconstructed exactly as emitted —
        // the generation suffix included. The recorded choice wins; for
        // older logs (no record, all generated with reasoning off) the
        // presence of thinking content is the only clue, as before.
        log.beginAssistantTurn({ thinking: entry.reasoning ?? Boolean(entry.thinking) });
        log.completeAssistantTurn(rawOf(entry));
        break;
    }
  }

  /** Frozen history — used by byte-identity tests. */
  get frozen(): string {
    return this.log?.frozen ?? '';
  }
}

/**
 * Raw output of an assistant turn. The provider's verbatim text is
 * authoritative — reconstructing from text/calls is only a safety net for
 * transcripts coming from another backend (the prefix then starts over
 * from that point).
 */
function rawOf(entry: Extract<TranscriptEntry, { role: 'assistant' }>): string {
  if (entry.raw !== undefined) return entry.raw;
  const think = entry.thinking ? `<think>${entry.thinking}</think>` : '';
  const calls = (entry.calls ?? [])
    .map(
      (call) =>
        `<tool_call>{"name": "${call.name}", "arguments": ${JSON.stringify(call.arguments)}}</tool_call>`,
    )
    .join('');
  return `${think}${entry.text}${calls}`;
}
