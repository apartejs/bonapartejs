/**
 * Parsing of raw Qwen3 output (Hermes format): reasoning blocks
 * `<think>…</think>` and tool calls
 * `<tool_call>{"name":…,"arguments":{…}}</tool_call>`.
 *
 * Robustness above all: a malformed block is COUNTED, never thrown — the
 * model has the right to get it wrong, the loop must be able to respond.
 */

export const TOOL_CALL_OPEN = '<tool_call>';
export const TOOL_CALL_CLOSE = '</tool_call>';
export const THINK_OPEN = '<think>';
export const THINK_CLOSE = '</think>';
export const IM_END = '<|im_end|>';

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ParsedOutput {
  /** Visible text: outside think, outside tool_call, truncated at <|im_end|>. */
  text: string;
  /** Concatenated content of the <think> blocks. */
  thinking: string;
  calls: ParsedToolCall[];
  /** tool_call blocks present but unusable. */
  malformed: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** null = unusable block (counted in `malformed`). */
function parseCall(payload: string): ParsedToolCall | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.trim());
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  const name = record?.['name'];
  if (typeof name !== 'string' || name.trim() === '') return null;

  const rawArgs = record?.['arguments'];
  // Some models serialize `arguments` as a JSON string rather than an object.
  if (typeof rawArgs === 'string') {
    try {
      return { name, arguments: asRecord(JSON.parse(rawArgs)) ?? {} };
    } catch {
      return { name, arguments: {} };
    }
  }
  return { name, arguments: asRecord(rawArgs) ?? {} };
}

export function parseHermesOutput(raw: string): ParsedOutput {
  const stop = raw.indexOf(IM_END);
  const source = stop === -1 ? raw : raw.slice(0, stop);

  const textParts: string[] = [];
  const thinkParts: string[] = [];
  const calls: ParsedToolCall[] = [];
  let malformed = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const thinkAt = source.indexOf(THINK_OPEN, cursor);
    const callAt = source.indexOf(TOOL_CALL_OPEN, cursor);
    const next =
      thinkAt === -1 ? callAt : callAt === -1 ? thinkAt : Math.min(thinkAt, callAt);

    if (next === -1) {
      textParts.push(source.slice(cursor));
      break;
    }
    textParts.push(source.slice(cursor, next));

    if (next === thinkAt) {
      const from = thinkAt + THINK_OPEN.length;
      const close = source.indexOf(THINK_CLOSE, from);
      if (close === -1) {
        // Generation cut off mid-reasoning: we keep the thought, no
        // phantom text.
        thinkParts.push(source.slice(from));
        break;
      }
      thinkParts.push(source.slice(from, close));
      cursor = close + THINK_CLOSE.length;
      continue;
    }

    const from = callAt + TOOL_CALL_OPEN.length;
    const close = source.indexOf(TOOL_CALL_CLOSE, from);
    if (close === -1) {
      malformed += 1;
      break;
    }
    const parsed = parseCall(source.slice(from, close));
    if (parsed) calls.push(parsed);
    else malformed += 1;
    cursor = close + TOOL_CALL_CLOSE.length;
  }

  return {
    text: textParts.join('').trim(),
    thinking: thinkParts.join('\n').trim(),
    calls,
    malformed,
  };
}
