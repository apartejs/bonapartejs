/**
 * What « always allow » remembers: a tool, or — for a command — the exact
 * command, or its whole program. A command is a program and its arguments,
 * run without a shell (`spawnHidden`): there is no first word to read out of
 * a string. A shell, or a line that chains, pipes or substitutes, is never
 * remembered, and a rule read from disk that could not have been remembered
 * answers nothing.
 */

export interface AllowRule {
  tool: string;
  /** A command's program, normalized (no folder, no case, no Windows extension). */
  program?: string;
  /** Exactly these arguments; absent: any argument of the program. */
  args?: readonly string[];
}

export interface CommandLine {
  program: string;
  args: readonly string[];
}

const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'nu', 'wsl']);
/** What chains, pipes or substitutes: `&&`, `|`, `;`, a backtick, `$(`. */
const CHAINS = /&&|\||;|`|\$\(/;

export function normalizeProgram(program: string): string {
  const name = program.trim().split(/[\\/]/).pop() ?? '';
  return name.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, '');
}

export function isRememberable(command: CommandLine): boolean {
  const program = normalizeProgram(command.program);
  if (program === '' || SHELLS.has(program)) return false;
  return ![command.program, ...command.args].some((part) => CHAINS.test(part));
}

export function alwaysRule(tool: string, command: CommandLine, scope: 'command' | 'program'): AllowRule {
  if (!isRememberable(command)) {
    throw new Error(`This command cannot be remembered: a shell, or a line that chains, pipes or substitutes, always asks.`);
  }
  const program = normalizeProgram(command.program);
  return scope === 'command' ? { tool, program, args: [...command.args] } : { tool, program };
}

/** A rule as it could have been remembered: what a rule read from disk must be to answer anything. */
export function isValidRule(rule: AllowRule): boolean {
  if (typeof rule.tool !== 'string' || rule.tool === '') return false;
  if (rule.program === undefined) return rule.args === undefined;
  return isRememberable({ program: rule.program, args: rule.args ?? [] }) && normalizeProgram(rule.program) === rule.program;
}

/** Does the rule answer this call: its tool, and for a command its program (and its arguments, when it names them)? */
export function matchesRule(rule: AllowRule, tool: string, command: CommandLine | undefined): boolean {
  if (rule.tool !== tool || !isValidRule(rule)) return false;
  // A tool-wide rule answers the tools that run no command.
  if (rule.program === undefined) return command === undefined;
  if (!command || !isRememberable(command)) return false;
  if (normalizeProgram(command.program) !== rule.program) return false;
  if (rule.args === undefined) return true;
  return rule.args.length === command.args.length && rule.args.every((arg, index) => arg === command.args[index]);
}
