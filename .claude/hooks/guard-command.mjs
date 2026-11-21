// PreToolUse guard for the Bash and PowerShell tools (see .claude/settings.json).
// Exit 0 lets the command run; exit 2 blocks it and hands stderr to the agent.
//
// It refuses what an agent must never do in this repository:
//   - push (Paul pushes, after validating in the app), but for main and a
//     release tag to the repository's origin, never forced (opened by Paul on
//     2026-11-21);
//   - skip a git hook or a signature;
//   - open a visible console window on Windows (it steals the foreground);
//   - force a file past .gitignore (the design notes are private);
//   - delete, move or overwrite archive/v0, the only copy of the first
//     implementation.
//
// It is a guard against accidents, not a sandbox: it reads a command the way
// its shell would, well enough for the forms people actually type.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PUSH =
  'Blocked: git push. Paul pushes, after validating in the app — the only pushes let through (opened by Paul on 2026-11-21) are `git push [-u] origin main` and `git push origin vX.Y.Z`, to apartejs/bonapartejs, never forced.';

/** The one repository a push may go to, whatever spelling git gives its address. */
const REPOSITORY = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)apartejs\/bonapartejs(?:\.git)?\/?$/i;

/** What `origin` points to, read from git; a test names it through BONAPARTE_GUARD_ORIGIN. */
function originUrl() {
  if (process.env.BONAPARTE_GUARD_ORIGIN !== undefined) return process.env.BONAPARTE_GUARD_ORIGIN;
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', windowsHide: true, shell: false });
  return result.status === 0 ? result.stdout.trim() : '';
}

/**
 * The pushes Paul opened on 2026-11-21: `git push [-u|--set-upstream] origin main`, or `git push origin vX.Y.Z`
 * (or refs/tags/vX.Y.Z) — one ref, no other option, no git option before `push`, and origin the repository.
 */
function allowedPush(args) {
  if (args[0] !== 'push') return false;
  const rest = args.slice(1).filter((arg) => arg !== '-u' && arg !== '--set-upstream');
  const upstream = rest.length !== args.length - 1;
  if (rest.length !== 2 || rest[0] !== 'origin') return false;
  const ref = rest[1];
  const main = ref === 'main';
  const tag = /^(?:refs\/tags\/)?v\d+\.\d+\.\d+$/.test(ref);
  if (!main && !(tag && !upstream)) return false;
  return REPOSITORY.test(originUrl());
}
const SKIP =
  'Blocked: never skip a git hook or a signature (--no-verify, -n, --no-gpg-sign, commit.gpgsign=false). Fix what the hook reports instead.';
const CONSOLE =
  'Blocked: this would open a visible console window. Use Start-Process with -WindowStyle Hidden or -NoNewWindow, or run the command in the background.';
const FORCE_ADD =
  'Blocked: git add --force would track a file that .gitignore keeps out (the private notes, local settings). If a file is ignored by mistake, fix .gitignore.';
const ARCHIVE =
  'Blocked: archive/v0 is the only copy of the first implementation (there is no remote). Never delete, move or overwrite that branch.';

/** git options that take their value as the next word. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);
const WINDOW_OPENERS = new Set(['wt', 'conhost']);
const START_PROCESS = new Set(['start-process', 'saps', 'start']);
const INVOKE_ITEM = new Set(['invoke-item', 'ii']);
/** Programs that run the program named after them. */
const RUNNERS = new Set(['npx', 'pnpx', 'bunx']);
const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun']);
const RUN_ANYTHING = new Set(['exec', 'dlx', 'x']);

/**
 * Drops the body of a here-document: it is text, not commands. What follows
 * the closing mark on its line is kept, since the shell runs it.
 */
function stripHereDocuments(text, shell) {
  const kept = [];
  // While inside a document: given a line, the rest of that line once the
  // document closes on it, or null when the line is still body.
  let closes = null;
  for (const line of text.split(/\r?\n/)) {
    if (closes !== null) {
      const rest = closes(line);
      if (rest !== null) {
        closes = null;
        if (rest.trim() !== '') kept.push(rest);
      }
      continue;
    }
    if (shell === 'powershell') {
      const open = /@(['"])\s*$/.exec(line);
      if (open) {
        const closing = `${open[1]}@`;
        kept.push(`${line.slice(0, open.index)} here-string`);
        closes = (candidate) => {
          const trimmed = candidate.trimStart();
          return trimmed.startsWith(closing) ? trimmed.slice(closing.length) : null;
        };
        continue;
      }
    }
    if (shell === 'bash') {
      const open = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line.replaceAll('<<<', ''));
      if (open) {
        const delimiter = open[2];
        kept.push(line);
        closes = (candidate) => (candidate.trim() === delimiter ? '' : null);
        continue;
      }
    }
    kept.push(line);
  }
  return kept.join('\n');
}

/**
 * Splits a command line into commands, each a list of words. Quotes and
 * escapes follow the shell that will run the line: a backslash escapes in
 * Bash, a backtick in PowerShell, and neither does in the other one.
 */
function splitCommands(text, shell) {
  const bash = shell === 'bash';
  const powershell = shell === 'powershell';
  // In Bash a backtick outside quotes opens a command substitution.
  const separators = bash ? ';|&\n(){}`' : ';|&\n(){}';
  const commands = [];
  let words = [];
  let word = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  /** Consumes an escaped character outside quotes; before a newline it is a line continuation. */
  const escaped = (i) => {
    const next = text[i + 1];
    if (next === '\r' && text[i + 2] === '\n') return i + 2;
    if (next !== '\n') word = (word ?? '') + next;
    return i + 1;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'") {
      let value = '';
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === "'") {
          if (!(powershell && text[j + 1] === "'")) break;
          j++; // '' is a quote inside a PowerShell single-quoted string
        }
        value += text[j];
      }
      word = (word ?? '') + value;
      i = j;
    } else if (char === '"') {
      let value = '';
      let j = i + 1;
      for (; j < text.length; j++) {
        const next = text[j + 1];
        if (text[j] === '"') {
          if (!(powershell && next === '"')) break;
          j++; // "" is a quote inside a PowerShell double-quoted string
        } else if (bash && text[j] === '\\' && next !== undefined && '"\\$`\n'.includes(next)) {
          j++;
          if (next === '\n') continue;
        } else if (powershell && text[j] === '`' && next !== undefined) {
          j++;
        }
        value += text[j];
      }
      word = (word ?? '') + value;
      i = j;
    } else if (bash && char === '\\' && i + 1 < text.length) {
      i = escaped(i);
    } else if (powershell && char === '`' && i + 1 < text.length) {
      i = escaped(i);
    } else if (char === '#' && word === null) {
      // A comment runs to the end of the line.
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline - 1;
    } else if (separators.includes(char)) {
      endCommand();
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word = (word ?? '') + char;
    }
  }
  endCommand();
  return commands;
}

/** `C:\Program Files\Git\bin\git.exe` → `git`. */
function programName(word) {
  const base = word.split(/[\\/]/).pop() ?? '';
  return base.toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
}

function gitSubcommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (GIT_VALUE_OPTIONS.has(args[i])) i++;
    else if (!args[i].startsWith('-')) return args[i];
  }
  return undefined;
}

/** Whether a short option such as `-n`, or a cluster such as `-anm`, holds one of the letters. */
function hasShortFlag(args, letters) {
  return args.some((arg) => /^-[A-Za-z]+$/.test(arg) && [...letters].some((letter) => arg.includes(letter)));
}

function threatensArchive(subcommand, args) {
  if (!args.some((arg) => arg === 'archive/v0' || arg === 'refs/heads/archive/v0')) return false;
  if (subcommand === 'update-ref') return true;
  if (subcommand === 'branch') {
    return args.some((arg) => /^--(delete|force|move)$/.test(arg)) || hasShortFlag(args, 'dDfmM');
  }
  if (subcommand === 'switch' || subcommand === 'checkout') {
    return args.includes('--force-create') || hasShortFlag(args, 'CB');
  }
  return false;
}

function staysHidden(args) {
  return args.some(
    (arg, i) =>
      /^-non[a-z]*$/i.test(arg) ||
      /^-wi[a-z]*:hidden$/i.test(arg) ||
      (/^-wi[a-z]*$/i.test(arg) && /^hidden$/i.test(args[i + 1] ?? '')),
  );
}

/** What the words after a wrapper run: one quoted string is a command line of its own. */
function refusalOfRest(words, shell) {
  if (words.length === 0) return undefined;
  if (words.length === 1) return firstRefusal(words[0], shell);
  return refusal(words, shell);
}

/** The reason the command a wrapper runs is refused, or undefined. */
function wrappedRefusal(name, args, shell) {
  if (SHELLS.has(name)) {
    const flag = args.findIndex((arg) => /^-[a-z]*c$/i.test(arg));
    const line = args[flag + 1];
    return flag === -1 || line === undefined ? undefined : firstRefusal(line, 'bash');
  }
  if (name === 'cmd') {
    // Git Bash needs `//c` to hand `/c` to cmd.
    const flag = args.findIndex((arg) => /^\/{1,2}[ck]$/i.test(arg));
    return flag === -1 ? undefined : refusalOfRest(args.slice(flag + 1), 'cmd');
  }
  if (POWERSHELLS.has(name)) {
    const flag = args.findIndex((arg) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(arg));
    const rest = flag === -1 ? args.filter((arg) => !arg.startsWith('-')) : args.slice(flag + 1);
    return refusalOfRest(rest, 'powershell');
  }
  if (RUNNERS.has(name) || PACKAGE_MANAGERS.has(name)) {
    let rest = args;
    if (PACKAGE_MANAGERS.has(name)) {
      const verb = args.findIndex((arg) => RUN_ANYTHING.has(arg));
      if (verb === -1) return undefined;
      rest = args.slice(verb + 1);
    }
    const program = rest.findIndex((arg) => !arg.startsWith('-'));
    return program === -1 ? undefined : refusal(rest.slice(program), shell);
  }
  return undefined;
}

/** The reason one command is refused, or undefined. */
function refusal(words, shell) {
  // `NAME=value command …` (Bash): the assignments are not the command.
  const start = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  if (start === -1) return undefined;
  const name = programName(words[start]);
  const args = words.slice(start + 1);

  if (args.some((arg) => /^--no-(verify|gpg-sign)$/i.test(arg))) return SKIP;

  if (name === 'git') {
    if (args.some((arg, i) => args[i - 1] === '-c' && /^commit\.gpgsign=(false|0|no|off)$/i.test(arg))) return SKIP;
    const subcommand = gitSubcommand(args);
    if (subcommand === 'push' && !allowedPush(args)) return PUSH;
    // For `git commit`, -n is the short form of --no-verify.
    if (subcommand === 'commit' && hasShortFlag(args, 'n')) return SKIP;
    if (subcommand === 'add' && (args.includes('--force') || hasShortFlag(args, 'f'))) return FORCE_ADD;
    if (threatensArchive(subcommand, args)) return ARCHIVE;
  }
  if (START_PROCESS.has(name) && !staysHidden(args)) return CONSOLE;
  if (WINDOW_OPENERS.has(name)) return CONSOLE;
  if (INVOKE_ITEM.has(name) && args.some((arg) => /\.(bat|cmd)$/i.test(arg))) return CONSOLE;

  return wrappedRefusal(name, args, shell);
}

function firstRefusal(text, shell) {
  for (const words of splitCommands(stripHereDocuments(text, shell), shell)) {
    const reason = refusal(words, shell);
    if (reason) return reason;
  }
  return undefined;
}

function readInput() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const command = input?.tool_input?.command;
    if (typeof command !== 'string') return undefined;
    return { command, shell: input.tool_name === 'PowerShell' ? 'powershell' : 'bash' };
  } catch {
    // Not a hook input this guard understands: it is not its call to make.
    return undefined;
  }
}

const input = readInput();
const reason = input === undefined ? undefined : firstRefusal(input.command, input.shell);
if (reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}
