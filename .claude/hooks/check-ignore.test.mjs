// Pins what git tracks under .claude/ and what stays private.
// The shared Claude Code configuration is versioned; notes, local settings
// and the design documents never are (the repository is public).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Asks git whether its ignore rules match a path. `--no-index` judges the
 * rules alone, so the answer does not depend on what is already committed.
 */
function isIgnored(path) {
  const result = spawnSync('git', ['check-ignore', '-q', '--no-index', path], {
    cwd: root,
    windowsHide: true,
  });
  assert.ok(
    result.status === 0 || result.status === 1,
    `git check-ignore failed for ${path}: ${String(result.stderr)}`,
  );
  return result.status === 0;
}

const ignored = [
  'docs/superpowers/x.md',
  '.claude/settings.local.json',
  '.claude/worktrees/x',
  '.claude/notes/x.md',
  'node_modules/x',
];

const tracked = [
  '.claude/settings.json',
  '.claude/agents/reviewer.md',
  '.claude/skills/friction/SKILL.md',
  '.claude/hooks/guard-command.mjs',
];

for (const path of ignored) {
  test(`${path} stays out of the repository`, () => {
    assert.equal(isIgnored(path), true);
  });
}

for (const path of tracked) {
  test(`${path} is tracked`, () => {
    assert.equal(isIgnored(path), false);
  });
}
