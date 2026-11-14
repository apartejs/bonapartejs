// guard-command runs before every Bash and PowerShell call. It refuses the
// three things an agent must never do in this repository: push, skip a git
// hook, and open a visible console window on Windows.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'guard-command.mjs');

/** Runs the hook the way Claude Code does: the hook input as JSON on stdin. */
function guard(command, toolName = 'Bash') {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ tool_name: toolName, tool_input: { command } }),
    encoding: 'utf8',
    windowsHide: true,
  });
  return { status: result.status, stderr: result.stderr };
}

const pushes = [
  'git push',
  'git push origin main',
  'git -C x push',
  'git -c user.name=x push --force',
  'git add . && git push',
  'cd repo; git push origin v1',
  'bash -c "git push"',
  '& "C:\\Program Files\\Git\\bin\\git.exe" push',
];

for (const command of pushes) {
  test(`refuses a push: ${command}`, () => {
    const { status, stderr } = guard(command);
    assert.equal(status, 2);
    assert.match(stderr, /Paul pushes, after validating in the app/);
  });
}

const skippedChecks = [
  'git commit --no-verify -m "x"',
  'git commit --no-gpg-sign -m x',
  'git -c commit.gpgsign=false commit -m x',
  'git merge --no-verify topic',
];

for (const command of skippedChecks) {
  test(`refuses to skip a hook or a signature: ${command}`, () => {
    const { status, stderr } = guard(command);
    assert.equal(status, 2);
    assert.match(stderr, /never skip/i);
  });
}

const visibleConsoles = [
  ['Start-Process notepad', 'PowerShell'],
  ["Start-Process node -ArgumentList 'server.js'", 'PowerShell'],
  ['start-process cmd -Wait', 'PowerShell'],
  ['cmd /c start notepad', 'Bash'],
  ['start "" x.bat', 'Bash'],
  ['wt new-tab', 'PowerShell'],
  ['conhost cmd', 'PowerShell'],
  ['Invoke-Item x.cmd', 'PowerShell'],
  ['Invoke-Item .\\scripts\\run.bat', 'PowerShell'],
  ['pwsh -Command "Start-Process notepad"', 'Bash'],
];

for (const [command, tool] of visibleConsoles) {
  test(`refuses a visible console: ${command}`, () => {
    const { status, stderr } = guard(command, tool);
    assert.equal(status, 2);
    assert.match(stderr, /visible console/);
  });
}

const allowed = [
  ['git status', 'Bash'],
  ['git commit -m "push the button"', 'Bash'],
  ['git commit -m "docs: never use --no-verify"', 'Bash'],
  ['git stash push -m wip', 'Bash'],
  ['git log --oneline -5', 'Bash'],
  ['echo "git push"', 'Bash'],
  ['Start-Process node -WindowStyle Hidden', 'PowerShell'],
  ['Start-Process node -ArgumentList server.js -NoNewWindow', 'PowerShell'],
  ['pnpm test', 'Bash'],
  ['pnpm start', 'Bash'],
  ['npm run start', 'Bash'],
  ['Invoke-Item report.html', 'PowerShell'],
];

for (const [command, tool] of allowed) {
  test(`lets through: ${command}`, () => {
    const { status, stderr } = guard(command, tool);
    assert.equal(status, 0, stderr);
  });
}

test('the body of a heredoc is text, not commands', () => {
  const command = ["cat >> notes.md <<'EOF'", 'git push is refused here', 'start "" x.bat', 'EOF'].join('\n');
  assert.equal(guard(command).status, 0);
});

test('a command after a heredoc is still checked', () => {
  const command = ["cat >> notes.md <<'EOF'", 'some text', 'EOF', 'git push'].join('\n');
  assert.equal(guard(command).status, 2);
});

test('lets through an input it does not understand', () => {
  const result = spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0);
});

// --- Found by the review of phase 0: ordinary ways of writing a command that
// --- used to hide what followed them.

const lines = (...parts) => parts.join('\n');

const hiddenBehindQuoting = [
  // A PowerShell here-string is how a multi-line commit message is written.
  [lines("git commit -m @'", 'feat: x', "'@", 'git push origin v1'), 'PowerShell', /Paul pushes/],
  [lines("git commit -m @'", 'msg', "'@; git push"), 'PowerShell', /Paul pushes/],
  [lines('$m = @"', 'some text', '"@', 'Start-Process notepad'), 'PowerShell', /visible console/],
  // In Bash a backtick inside double quotes is not an escape character.
  ['git commit -am "fix \\`x\\`" && git push', 'Bash', /Paul pushes/],
  // The Bash idiom for an apostrophe inside single quotes.
  ["git commit -m 'Paul'\\''s fix' && git push", 'Bash', /Paul pushes/],
  ["echo it\\'s && git push", 'Bash', /Paul pushes/],
  // Git Bash needs `//c` to hand `/c` to cmd.
  ['cmd //c start "" pnpm dev', 'Bash', /visible console/],
  ['cmd //c "git push"', 'Bash', /Paul pushes/],
  // Package runners run whatever follows them.
  ['pnpm exec git push', 'Bash', /Paul pushes/],
  ['pnpm --filter app exec git push', 'Bash', /Paul pushes/],
  ['npx --yes git push', 'Bash', /Paul pushes/],
];

for (const [command, tool, message] of hiddenBehindQuoting) {
  test(`sees through the quoting: ${JSON.stringify(command)}`, () => {
    const { status, stderr } = guard(command, tool);
    assert.equal(status, 2);
    assert.match(stderr, message);
  });
}

const stillAllowed = [
  [lines("git commit -m @'", 'docs: explain why git push is refused', "'@"), 'PowerShell'],
  ['git commit -am "fix \\`x\\`"', 'Bash'],
  ["git commit -m 'Paul'\\''s fix'", 'Bash'],
  ['pnpm exec vitest run -t "git push is refused"', 'Bash'],
  ['git commit -am "x"', 'Bash'],
  ['git merge -n topic', 'Bash'],
  ['git add -A', 'Bash'],
  ['git add .gitignore packages/core', 'Bash'],
  ['git branch -D feature/x', 'Bash'],
  ['git show archive/v0:README.md', 'Bash'],
  ['git log --oneline archive/v0', 'Bash'],
  ['git branch --list archive/v0', 'Bash'],
];

for (const [command, tool] of stillAllowed) {
  test(`still lets through: ${JSON.stringify(command)}`, () => {
    const { status, stderr } = guard(command, tool);
    assert.equal(status, 0, stderr);
  });
}

for (const command of ['git commit -n -m "x"', 'git commit -nm "x"', 'git commit -anm x']) {
  test(`refuses the short form of --no-verify: ${command}`, () => {
    const { status, stderr } = guard(command);
    assert.equal(status, 2);
    assert.match(stderr, /never skip/i);
  });
}

for (const command of ["Start-Process pwsh -ArgumentList '-NoExit'", 'Start-Process pwsh -ArgumentList -NoLogo']) {
  test(`an option meant for the child does not hide the window: ${command}`, () => {
    const { status, stderr } = guard(command, 'PowerShell');
    assert.equal(status, 2);
    assert.match(stderr, /visible console/);
  });
}

for (const command of ['git add -f docs/superpowers/plans/SUIVI.md', 'git add --force .claude/notes/x.md', 'git add -Af']) {
  test(`refuses to force a file past .gitignore: ${command}`, () => {
    const { status, stderr } = guard(command);
    assert.equal(status, 2);
    assert.match(stderr, /\.gitignore/);
  });
}

const archiveAtRisk = [
  'git branch -D archive/v0',
  'git branch -d archive/v0',
  'git branch --delete archive/v0',
  'git branch -M archive/v0 old-v0',
  'git branch -f archive/v0 HEAD',
  'git switch -C archive/v0',
  'git checkout -B archive/v0 HEAD',
  'git update-ref -d refs/heads/archive/v0',
];

for (const command of archiveAtRisk) {
  test(`protects the only copy of v0: ${command}`, () => {
    const { status, stderr } = guard(command);
    assert.equal(status, 2);
    assert.match(stderr, /archive\/v0/);
  });
}
