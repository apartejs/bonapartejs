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
