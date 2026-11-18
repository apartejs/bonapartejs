/**
 * The mascot's state (task 12.2, board « Logo et ses états »): ten states, from what the engine does and what a
 * turn of the conversation shown is doing — the most urgent first: a failure, a request that waits, the work (read
 * again, reasoning, writing), the engine waking or asleep, a turn that ended well (1.5 s), the pointer over it.
 */

export type MascotState = 'idle' | 'thinking' | 'talking' | 'reading' | 'waiting' | 'happy' | 'surprised' | 'error' | 'sleeping' | 'wake';

export const MASCOT_STATES: readonly MascotState[] = ['idle', 'thinking', 'talking', 'reading', 'waiting', 'happy', 'surprised', 'error', 'sleeping', 'wake'];

/** What a turn is doing, as its stream says. */
export type TurnActivity = 'thinking' | 'writing' | 'reading' | 'waiting' | 'failed' | 'stopped' | 'done';

/** The engine as the window knows it; `none` before one is chosen (the first launch). */
export type EngineLike = 'stopped' | 'starting' | 'ready' | 'crashed' | 'restarting' | 'none';

export interface MascotInput {
  engine: EngineLike;
  activity: TurnActivity | null;
  /** Until when a turn that ended well is celebrated (ms). */
  happyUntil: number;
  now: number;
  hovered: boolean;
}

/** How long the mascot is content after a turn that ended well. */
export const HAPPY_MS = 1_500;

const READING_STEPS = new Set(['reread', 'restore', 'seed']);

/** One event of a turn's stream, read as what the turn is doing now — or null when it says nothing new. */
export function activityOf(event: { type: string; name?: unknown } & Record<string, unknown>): TurnActivity | null {
  switch (event.type) {
    case 'thinking-delta':
    // A request answered: the turn works again.
    case 'tool-approved':
    case 'tool-rejected':
      return 'thinking';
    case 'text-delta':
      return 'writing';
    case 'step-start':
      return typeof event.name === 'string' && READING_STEPS.has(event.name) ? 'reading' : null;
    case 'tool-awaiting-approval':
    case 'run-suspended':
      return 'waiting';
    case 'run-error':
      return 'failed';
    case 'run-aborted':
      return 'stopped';
    case 'run-done':
      return 'done';
    default:
      return null;
  }
}

export function mascotState(input: MascotInput): MascotState {
  if (input.activity === 'failed' || input.engine === 'crashed') return 'error';
  if (input.activity === 'waiting') return 'waiting';
  if (input.activity === 'reading') return 'reading';
  if (input.activity === 'thinking') return 'thinking';
  if (input.activity === 'writing') return 'talking';
  if (input.engine === 'starting' || input.engine === 'restarting') return 'wake';
  if (input.engine === 'stopped') return 'sleeping';
  if (input.activity === 'done' && input.now < input.happyUntil) return 'happy';
  if (input.hovered) return 'surprised';
  return 'idle';
}
