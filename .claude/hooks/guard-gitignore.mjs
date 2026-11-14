// PostToolUse guard for the Edit and Write tools (see .claude/settings.json).
// The design notes live in docs/superpowers/ and this repository is public:
// the line that ignores them must never leave the root .gitignore.
//
// The edit has already happened when this runs, so exit 2 cannot undo it: it
// hands stderr to the agent, which must put the line back.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINE = 'docs/superpowers/';

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function editedFile() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const filePath = input?.tool_input?.file_path;
    return typeof filePath === 'string' ? filePath : undefined;
  } catch {
    // Not a hook input this guard understands: it is not its call to make.
    return undefined;
  }
}

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function keepsTheLine(file) {
  try {
    return readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .some((line) => line.trim() === LINE);
  } catch {
    // An unreadable or missing .gitignore ignores nothing.
    return false;
  }
}

const root = projectRoot();
const rootIgnore = resolve(root, '.gitignore');
const edited = editedFile();

if (edited !== undefined && samePath(resolve(root, edited), rootIgnore) && !keepsTheLine(rootIgnore)) {
  process.stderr.write(
    `Blocked: the root .gitignore must keep the line "${LINE}". The design notes are private and this repository is public. Put the line back before anything else.\n`,
  );
  process.exit(2);
}
