// PreToolUse guard for the Bash and PowerShell tools (see .claude/settings.json).
// Exit 0 lets the command run; exit 2 blocks it and hands stderr to the agent.
//
// It refuses three things an agent must never do in this repository:
//   - push (Paul pushes, after validating in the app);
//   - skip a git hook or a signature;
//   - open a visible console window on Windows (it steals the foreground).
//
// It is a guard against accidents, not a sandbox: it reads a command the way a
// shell would, well enough for the forms people actually type.
import { readFileSync } from 'node:fs';

const PUSH = 'Blocked: git push. Paul pushes, after validating in the app.';
const SKIP =
  'Blocked: never skip a git hook or a signature (--no-verify, --no-gpg-sign, commit.gpgsign=false). Fix what the hook reports instead.';
const CONSOLE =
  'Blocked: this would open a visible console window. Use Start-Process with -WindowStyle Hidden or -NoNewWindow, or run the command in the background.';

/** git options that take their value as the next word. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);
const WINDOW_OPENERS = new Set(['wt', 'conhost']);
const START_PROCESS = new Set(['start-process', 'saps', 'start']);
const INVOKE_ITEM = new Set(['invoke-item', 'ii']);

/** Drops the body of bash heredocs and PowerShell here-strings: it is text, not commands. */
function stripHereDocuments(text) {
  const kept = [];
  let until = null;
  for (const line of text.split(/\r?\n/)) {
    if (until !== null) {
      if (until(line)) until = null;
      continue;
    }
    kept.push(line);
    const heredoc = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line.replaceAll('<<<', ''));
    if (heredoc) {
      const delimiter = heredoc[2];
      until = (candidate) => candidate.trim() === delimiter;
      continue;
    }
    const hereString = /@(['"])\s*$/.exec(line);
    if (hereString) {
      const closing = `${hereString[1]}@`;
      until = (candidate) => candidate.trimStart().startsWith(closing);
    }
  }
  return kept.join('\n');
}

/** Splits a command line into commands, each a list of words; quotes are honoured and removed. */
function splitCommands(text) {
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

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'") {
      const close = text.indexOf("'", i + 1);
      const end = close === -1 ? text.length : close;
      word = (word ?? '') + text.slice(i + 1, end);
      i = end;
    } else if (char === '"') {
      let value = '';
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        // Inside double quotes a backslash only escapes a quote or itself (so a
        // Windows path keeps its separators); a PowerShell backtick escapes anything.
        const escapes = text[j] === '`' || (text[j] === '\\' && (text[j + 1] === '"' || text[j + 1] === '\\'));
        if (escapes && j + 1 < text.length) j++;
        value += text[j];
      }
      word = (word ?? '') + value;
      i = j;
    } else if ((char === '\\' || char === '`') && (text[i + 1] === '\n' || text.startsWith('\r\n', i + 1))) {
      // Line continuation.
      i += text[i + 1] === '\n' ? 1 : 2;
    } else if (char === '#' && word === null) {
      // A comment runs to the end of the line.
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline - 1;
    } else if (';|&\n(){}`'.includes(char)) {
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

function staysHidden(args) {
  return args.some(
    (arg, i) =>
      /^-no[a-z]*$/i.test(arg) ||
      /^-wi[a-z]*:hidden$/i.test(arg) ||
      (/^-wi[a-z]*$/i.test(arg) && /^hidden$/i.test(args[i + 1] ?? '')),
  );
}

/** The command line a shell wrapper runs, or undefined when it runs none. */
function wrappedCommand(name, args) {
  if (SHELLS.has(name)) {
    const flag = args.findIndex((arg) => /^-[a-z]*c$/i.test(arg));
    return flag === -1 ? undefined : args[flag + 1];
  }
  if (name === 'cmd') {
    const flag = args.findIndex((arg) => /^\/[ck]$/i.test(arg));
    return flag === -1 ? undefined : args.slice(flag + 1).join(' ');
  }
  if (POWERSHELLS.has(name)) {
    const flag = args.findIndex((arg) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(arg));
    if (flag !== -1) return args.slice(flag + 1).join(' ');
    return args.filter((arg) => !arg.startsWith('-')).join(' ');
  }
  return undefined;
}

/** The reason one command is refused, or undefined. */
function refusal(words) {
  // `NAME=value command …` (bash): the assignments are not the command.
  const start = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  if (start === -1) return undefined;
  const name = programName(words[start]);
  const args = words.slice(start + 1);

  if (args.some((arg) => /^--no-(verify|gpg-sign)$/i.test(arg))) return SKIP;

  if (name === 'git') {
    if (args.some((arg, i) => args[i - 1] === '-c' && /^commit\.gpgsign=(false|0|no|off)$/i.test(arg))) return SKIP;
    if (gitSubcommand(args) === 'push') return PUSH;
  }
  if (START_PROCESS.has(name) && !staysHidden(args)) return CONSOLE;
  if (WINDOW_OPENERS.has(name)) return CONSOLE;
  if (INVOKE_ITEM.has(name) && args.some((arg) => /\.(bat|cmd)$/i.test(arg))) return CONSOLE;

  const inner = wrappedCommand(name, args);
  return inner === undefined ? undefined : firstRefusal(inner);
}

function firstRefusal(text) {
  for (const words of splitCommands(stripHereDocuments(text))) {
    const reason = refusal(words);
    if (reason) return reason;
  }
  return undefined;
}

function readCommand() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const command = input?.tool_input?.command;
    return typeof command === 'string' ? command : undefined;
  } catch {
    // Not a hook input this guard understands: it is not its call to make.
    return undefined;
  }
}

const command = readCommand();
const reason = command === undefined ? undefined : firstRefusal(command);
if (reason) {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}
