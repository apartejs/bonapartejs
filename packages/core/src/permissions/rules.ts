/**
 * What « always allow » remembers (audit 2026-11-21, D3), the way the market
 * does it — never more than what the card showed:
 * - a command: exactly that program and those arguments (security rule 2:
 *   the exact command, never its first word). A command is a program and its
 *   arguments, run without a shell (`spawnHidden`); a shell, or a line that
 *   chains, pipes or substitutes, is never remembered;
 * - a write: the file, or every file of its folder (`src/**`), relative to a
 *   folder of the perimeter;
 * - a page: its site — its origin, scheme, host and port (`http://localhost:5173`);
 * - a tool whose calls name none of those (an MCP server's tool, web_search):
 *   the tool.
 * A rule read from disk that could not have been remembered answers nothing.
 */

export interface AllowRule {
  tool: string;
  /** A command's program, normalized (no folder, no case, no Windows extension) — with its exact arguments. */
  program?: string;
  /** Exactly these arguments; always given with a program. */
  args?: readonly string[];
  /** A write's file, or folder (`src/**`): relative to a folder of the perimeter, `/`-separated. */
  path?: string;
  /** A page's site: `scheme://host[:port]`, as `new URL(…).origin` writes it. */
  origin?: string;
}

export interface CommandLine {
  program: string;
  args: readonly string[];
}

/** What one call names — what a rule may answer for. */
export type CallSubject =
  | { kind: 'command'; command: CommandLine }
  /** A write, relative to the folder of the perimeter it lands in; null outside every one. */
  | { kind: 'path'; relative: string | null }
  /** A page; null when its site is not known (no page open, an address that is not http(s)). */
  | { kind: 'origin'; origin: string | null }
  | { kind: 'none' };

/** Why a call that asks cannot be remembered: said on the card. */
export type NeverRemembered = 'shell' | 'chain' | 'armed' | 'outside' | 'third-party' | 'sensitive' | 'unknown';

const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'nu', 'wsl']);
/** What chains, pipes or substitutes: `&&`, `|`, `;`, a backtick, `$(`. */
const CHAINS = /&&|\||;|`|\$\(/;

export function normalizeProgram(program: string): string {
  const name = program.trim().split(/[\\/]/).pop() ?? '';
  return name.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, '');
}

export function isShell(command: CommandLine): boolean {
  const program = normalizeProgram(command.program);
  return program === '' || SHELLS.has(program);
}

export function chains(command: CommandLine): boolean {
  return [command.program, ...command.args].some((part) => CHAINS.test(part));
}

export function isRememberable(command: CommandLine): boolean {
  return !isShell(command) && !chains(command);
}

/** A page's site, as a rule keeps it: http(s) only, its origin; null for anything else. */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** A path as a rule keeps it: relative, `/`-separated, never climbing out, never absolute. */
function isRelativePath(path: string): boolean {
  if (path === '' || path.includes('\\') || path.startsWith('/') || /^[a-z]:/i.test(path)) return false;
  const parts = path.split('/');
  return parts.every((part, index) => part !== '' && part !== '.' && part !== '..' && (part !== '**' || index === parts.length - 1)) && !/[*?[\]]/.test(path.replace(/\/\*\*$/, ''));
}

/** The folder a write's rule names: every file under it, or the file itself at the top of the perimeter. */
export function pathPattern(relative: string): string {
  const slash = relative.lastIndexOf('/');
  return slash > 0 ? `${relative.slice(0, slash)}/**` : relative;
}

/** The rule « always allow » would remember for a call, or why none. */
export function ruleFor(tool: string, subject: CallSubject): AllowRule | { never: NeverRemembered } {
  switch (subject.kind) {
    case 'command':
      if (isShell(subject.command)) return { never: 'shell' };
      if (chains(subject.command)) return { never: 'chain' };
      return { tool, program: normalizeProgram(subject.command.program), args: [...subject.command.args] };
    case 'path':
      return subject.relative === null ? { never: 'outside' } : { tool, path: pathPattern(subject.relative) };
    case 'origin':
      return subject.origin === null ? { never: 'unknown' } : { tool, origin: subject.origin };
    case 'none':
      return { tool };
  }
}

/** A rule as it could have been remembered: what a rule read from disk must be to answer anything. */
export function isValidRule(rule: AllowRule): boolean {
  if (typeof rule !== 'object' || rule === null || typeof rule.tool !== 'string' || rule.tool === '') return false;
  const named = [rule.program !== undefined, rule.path !== undefined, rule.origin !== undefined].filter(Boolean).length;
  if (named > 1) return false;
  if (rule.program !== undefined) {
    // The exact command only: a program without its arguments would be its first word (security rule 2).
    if (!Array.isArray(rule.args) || !rule.args.every((arg) => typeof arg === 'string')) return false;
    return isRememberable({ program: rule.program, args: rule.args }) && normalizeProgram(rule.program) === rule.program;
  }
  if (rule.args !== undefined) return false;
  if (rule.path !== undefined) return typeof rule.path === 'string' && isRelativePath(rule.path);
  if (rule.origin !== undefined) return typeof rule.origin === 'string' && originOf(rule.origin) === rule.origin;
  return true;
}

function samePath(a: string, b: string): boolean {
  // Windows' and macOS's folders do not tell case apart.
  return process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase();
}

/** Does the rule answer this call: its tool, and what the call names — exactly what the rule names? */
export function matchesRule(rule: AllowRule, tool: string, subject: CallSubject): boolean {
  if (rule.tool !== tool || !isValidRule(rule)) return false;
  switch (subject.kind) {
    case 'command': {
      if (rule.program === undefined || !isRememberable(subject.command)) return false;
      if (normalizeProgram(subject.command.program) !== rule.program) return false;
      const args = rule.args ?? [];
      return args.length === subject.command.args.length && args.every((arg, index) => arg === subject.command.args[index]);
    }
    case 'path': {
      if (rule.path === undefined || subject.relative === null) return false;
      if (!rule.path.endsWith('/**')) return samePath(rule.path, subject.relative);
      const folder = rule.path.slice(0, -2);
      return subject.relative.length > folder.length && samePath(subject.relative.slice(0, folder.length), folder);
    }
    case 'origin':
      return rule.origin !== undefined && subject.origin !== null && rule.origin === subject.origin;
    case 'none':
      // A tool-wide rule answers the calls that name nothing.
      return rule.program === undefined && rule.path === undefined && rule.origin === undefined;
  }
}

/** Two rules that answer the same calls. */
export function sameRule(a: AllowRule, b: AllowRule): boolean {
  return (
    a.tool === b.tool &&
    a.program === b.program &&
    a.path === b.path &&
    a.origin === b.origin &&
    (a.args === undefined) === (b.args === undefined) &&
    (a.args ?? []).length === (b.args ?? []).length &&
    (a.args ?? []).every((arg, index) => arg === b.args?.[index])
  );
}
