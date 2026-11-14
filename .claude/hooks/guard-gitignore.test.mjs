// guard-gitignore runs after every Edit and Write. The design notes live in
// docs/superpowers/ and the repository is public: the line that ignores them
// must never leave the root .gitignore.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'guard-gitignore.mjs');
const projects = [];

/** A throwaway project whose root .gitignore holds the given lines. */
function project(lines) {
  const root = mkdtempSync(join(tmpdir(), 'guard-gitignore-'));
  projects.push(root);
  writeFileSync(join(root, '.gitignore'), `${lines.join('\n')}\n`);
  return root;
}

/** Runs the hook the way Claude Code does after an edit of `filePath`. */
function guard(root, filePath) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    windowsHide: true,
  });
  return { status: result.status, stderr: result.stderr };
}

after(() => {
  for (const root of projects) rmSync(root, { recursive: true, force: true });
});

test('refuses a root .gitignore that lost the private notes line', () => {
  const root = project(['node_modules/', 'dist/']);
  const { status, stderr } = guard(root, join(root, '.gitignore'));
  assert.equal(status, 2);
  assert.match(stderr, /docs\/superpowers\//);
});

test('refuses when the line is only there as a comment', () => {
  const root = project(['node_modules/', '# docs/superpowers/']);
  assert.equal(guard(root, join(root, '.gitignore')).status, 2);
});

test('lets through a root .gitignore that keeps the line', () => {
  const root = project(['node_modules/', 'docs/superpowers/', 'dist/']);
  const { status, stderr } = guard(root, join(root, '.gitignore'));
  assert.equal(status, 0, stderr);
});

test('accepts the path with forward slashes', () => {
  const root = project(['node_modules/']);
  const forward = join(root, '.gitignore').replaceAll('\\', '/');
  assert.equal(guard(root, forward).status, 2);
});

test('lets through any other file, whatever the root .gitignore says', () => {
  const root = project(['node_modules/']);
  writeFileSync(join(root, 'README.md'), '# x\n');
  assert.equal(guard(root, join(root, 'README.md')).status, 0);
});

test('lets through a .gitignore that is not the root one', () => {
  const root = project(['docs/superpowers/']);
  mkdirSync(join(root, 'packages', 'app'), { recursive: true });
  writeFileSync(join(root, 'packages', 'app', '.gitignore'), 'out/\n');
  assert.equal(guard(root, join(root, 'packages', 'app', '.gitignore')).status, 0);
});

test('lets through an input it does not understand', () => {
  const result = spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0);
});
