/**
 * A conversation that changes model (task 7.4). The frozen text of a branch
 * was written for one family; another model reads another template. So a
 * change of model is an explicit event, like a compaction: an `engine` entry
 * whose text is the system prompt frozen again with the truth of the moment
 * (the head), then the whole conversation rendered again by the new family —
 * each turn of the person; each answer's text and calls, read back by the
 * family that wrote it, without its reasoning; each tool result; each note of
 * a going back. The notes of state (mode, tools, folders, language,
 * instructions) are folded into the head; the mode is told again after it.
 * After a compaction, the summary stands for what it folded.
 */

import { familyLayer, familyOfPrompt, type FamilyId, type FamilyLayer } from '../families/index.js';
import type { EarlierAnswer } from '../families/types.js';
import type { JournalEntry } from '../journal/types.js';
import { summaryNote } from './compact.js';

export interface Rerender {
  /** The family the new model is spoken to through. */
  to: FamilyLayer;
  /** Its system turn and the project's note, frozen for it. */
  head: string;
  /** The family of a journal that does not say which wrote it (older than the record). */
  from: FamilyLayer;
}

/** The model and family a branch's prompt is frozen for: its last change of model, else its first system turn. */
export function branchModel(entries: readonly JournalEntry[]): { modelId?: string; family?: FamilyId } {
  const change = entries.findLast((entry): entry is Extract<JournalEntry, { kind: 'engine' }> => entry.kind === 'engine');
  if (change) return { modelId: change.modelId, family: change.family };
  const system = entries.find((entry): entry is Extract<JournalEntry, { kind: 'system' }> => entry.kind === 'system');
  if (!system) return {};
  const family = system.family ?? familyOfPrompt(system.rendered ?? '') ?? undefined;
  return { ...(system.modelId ? { modelId: system.modelId } : {}), ...(family ? { family } : {}) };
}

/** What an answer said, read back by the family that wrote it: its text and its calls, not its reasoning. */
function readAnswer(family: FamilyLayer, raw: string): { text: string; calls: EarlierAnswer['calls'] } {
  const demux = family.createDemux();
  let text = '';
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  for (const piece of [...demux.push(raw), ...demux.flush()]) {
    if (piece.type === 'text') text += piece.delta;
    else if (piece.type === 'tool-call') calls.push({ name: piece.name, input: piece.input });
  }
  return { text, calls };
}

/** What a re-render passes by: the events of the journal, and the text a change of model or a rebase froze. */
const SILENT = new Set<JournalEntry['kind']>(['system', 'rebase', 'engine', 'pending', 'outcomes', 'rewind', 'withdrawn']);

/**
 * The family that wrote each entry of a branch: its first system turn's, then each change of model's —
 * `fallback` for a journal that says none.
 */
export function writersOf(entries: readonly JournalEntry[], fallback: FamilyLayer): Map<string, FamilyLayer> {
  const writers = new Map<string, FamilyLayer>();
  const first = entries.find((item) => item.kind === 'system');
  let writer = fallback;
  for (const item of entries) {
    if (item === first && item.kind === 'system') {
      const family = item.family ?? familyOfPrompt(item.rendered ?? '');
      if (family) writer = familyLayer(family);
    } else if (item.kind === 'engine' && item.family) {
      // A service names no family: what it wrote is plain text, read by the family before it.
      writer = familyLayer(item.family);
    }
    writers.set(item.id, writer);
  }
  return writers;
}

/** The text of the `engine` entry: the head, then the conversation rendered again by the new family. */
export function rerenderConversation(entries: readonly JournalEntry[], options: Rerender): string {
  const { to } = options;
  const writers = writersOf(entries, options.from);

  // From the last compaction: the summary, the turns it kept as they were, what came after.
  const rebaseAt = entries.findLastIndex((item) => item.kind === 'rebase');
  let text = options.head;
  let walked: readonly JournalEntry[] = entries;
  if (rebaseAt >= 0) {
    const rebase = entries[rebaseAt] as Extract<JournalEntry, { kind: 'rebase' }>;
    text += to.renderSystemNote(summaryNote(rebase.summary, rebase.keptRound !== undefined));
    const keptAt = rebase.keptFrom ? entries.findIndex((item) => item.id === rebase.keptFrom) : -1;
    // A turn folded on itself kept its message and its last round only: its earlier rounds are in the summary.
    const roundAt = rebase.keptRound ? entries.findIndex((item) => item.id === rebase.keptRound) : -1;
    const kept = keptAt < 0 ? [] : roundAt > keptAt ? [entries[keptAt]!, ...entries.slice(roundAt, rebaseAt)] : entries.slice(keptAt, rebaseAt);
    walked = [...kept, ...entries.slice(rebaseAt + 1)];
  }
  const spoken = walked.filter((item) => !SILENT.has(item.kind) && (item.kind !== 'delta' || item.delta.kind === 'note'));

  spoken.forEach((item, index) => {
    if (item.kind === 'user') text += to.renderUser(item.text);
    else if (item.kind === 'delta') text += to.renderSystemNote(item.delta.text);
    else if (item.kind === 'tool-results') text += to.renderToolResults(item.results);
    else if (item.kind === 'assistant') {
      const said = readAnswer(writers.get(item.id) ?? options.from, item.raw);
      // A call is rendered only when its results follow — or are awaited, the branch ending on its pause: the
      // resume brings them. One nobody answered closes its turn instead.
      const awaited = index === spoken.length - 1 && (walked.at(-1)?.kind === 'pending' || walked.at(-1)?.kind === 'outcomes');
      const answered = spoken[index + 1]?.kind === 'tool-results' || awaited;
      const continuing = spoken[index - 1]?.kind === 'tool-results';
      text += to.renderAnswer({ text: said.text, calls: answered ? said.calls : [], ...(continuing ? { continuing } : {}) });
    }
  });
  return text;
}
