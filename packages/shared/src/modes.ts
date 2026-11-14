/**
 * The four approval modes. They keep aparté's French names in the product:
 *
 * - `lecture` — reads only, and plans; nothing is written or run;
 * - `repetition` — asks before every change;
 * - `plume` — edits pass, commands ask;
 * - `impro` — asks only what is always asked.
 */
export type PlayMode = 'lecture' | 'repetition' | 'plume' | 'impro';

/**
 * What a tool does to the world. A tool that does not declare its effect is
 * treated as `execute`.
 */
export type ToolEffect = 'read' | 'write' | 'execute' | 'network' | 'ui';

/** What the approval policy rules on one tool call. */
export type Verdict =
  | { verdict: 'allow' }
  | { verdict: 'ask'; why: 'mode' | 'armed-path' | 'outside-project' | 'network' | 'undeclared-effect' }
  | { verdict: 'deny'; reason: string };
