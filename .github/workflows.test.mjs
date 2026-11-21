// The workflows, read as GitHub will run them (audit 2026-11-21, N1 and N2).
// They cannot be run here, and the first run on GitHub is a release: these
// tests check what a reading can — every action pinned to a commit, every job
// bounded in time, the triggers, and the minutes a private repository pays.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'workflows');
const read = (name) => readFileSync(join(dir, name), 'utf8').replaceAll('\r\n', '\n');
const ci = read('ci.yml');
const release = read('release.yml');

/** The jobs of a workflow, each with the text of its block. */
function jobs(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('jobs:');
  assert.notEqual(start, -1, 'a workflow has its jobs');
  const found = new Map();
  let name = null;
  for (const line of lines.slice(start + 1)) {
    const head = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line);
    if (head) {
      name = head[1];
      found.set(name, '');
    } else if (name) found.set(name, `${found.get(name)}${line}\n`);
  }
  return found;
}

/** The `on:` block of a workflow. */
function triggers(text) {
  const match = /^on:\n((?: {2}.*\n|\n)+)/m.exec(text);
  assert.ok(match, 'a workflow says when it runs');
  return match[1];
}

for (const [file, text] of [['ci.yml', ci], ['release.yml', release]]) {
  test(`${file}: every action is pinned to a full commit, its version named`, () => {
    const uses = [...text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/gm)];
    assert.ok(uses.length > 0);
    for (const [, ref, rest] of uses) {
      assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${ref} is pinned to a commit`);
      assert.match(rest, /#\s*v\d/, `${ref} names the version of its commit`);
    }
  });

  test(`${file}: every job is bounded in time (a stuck job would run six hours)`, () => {
    for (const [name, block] of jobs(text)) assert.match(block, /^ {4}timeout-minutes: \d+$/m, `${name} has timeout-minutes`);
  });

  test(`${file}: can be run by hand`, () => {
    assert.match(triggers(text), /^ {2}workflow_dispatch:/m);
  });
}

test('ci.yml: runs on pull requests and pushes to main only, an older run cancelled', () => {
  const on = triggers(ci);
  assert.match(on, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.match(on, /^ {2}pull_request:\n {4}branches: \[main\]$/m);
  assert.match(ci, /^ {2}cancel-in-progress: true$/m);
});

test('ci.yml: the end-to-end tests run on one platform, Windows (minutes ×2 on a private repository)', () => {
  const e2e = [...ci.matchAll(/^\s*- name: (End-to-end[^\n]*)\n((?: {8}.*\n)+)/gm)];
  assert.equal(e2e.length, 1, 'one end-to-end step');
  assert.match(e2e[0][2], /if: runner\.os == 'Windows'/);
});

test('release.yml: Windows by default; macOS (×10) and Linux only when asked', () => {
  assert.match(triggers(release), /^ {2}push:\n {4}tags: \['v\*'\]$/m);
  const os = /^ {8}os: (.+)$/m.exec(release);
  assert.ok(os, 'the matrix names its systems');
  assert.match(os[1], /windows-2025-vs2026/);
  // macOS and Linux appear only behind the inputs of a run by hand.
  assert.match(os[1], /inputs\.macos && ',"macos-latest"'/);
  assert.match(os[1], /inputs\.linux && ',"ubuntu-latest"'/);
  assert.match(release, /^ {6}macos:\n(?: {8}.*\n)*? {8}type: boolean\n(?: {8}.*\n)*? {8}default: false$/m);
  assert.match(release, /^ {6}linux:\n(?: {8}.*\n)*? {8}type: boolean\n(?: {8}.*\n)*? {8}default: false$/m);
});

test('release.yml: only a tag makes a release; a run by hand keeps its installer as an artifact', () => {
  const all = jobs(release);
  assert.match(all.get('draft'), /^ {4}if: startsWith\(github\.ref, 'refs\/tags\/v'\)$/m);
  // The installers still run when the draft was skipped (a run by hand on a branch).
  assert.match(all.get('installer'), /^ {4}if: \$\{\{ !failure\(\) && !cancelled\(\) \}\}$/m);
  assert.match(release, /--publish always/);
  assert.match(release, /--publish never/);
  assert.match(release, /actions\/upload-artifact@/);
});

test('release.yml: the tag and the version are checked before anything is built', () => {
  const steps = jobs(release).get('installer');
  const check = steps.indexOf('Check the version');
  const install = steps.indexOf('Install dependencies');
  assert.ok(check > 0 && check < install, 'the version is checked first');
});

test('release.yml: packing and running the packed app are two steps (pwsh would not stop between two commands)', () => {
  const steps = jobs(release).get('installer');
  for (const block of steps.split(/\n(?= {6}- )/)) {
    if (!/run: \|/.test(block) || /shell: bash/.test(block)) continue;
    const commands = block.slice(block.indexOf('run: |') + 6).split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
    assert.ok(commands.length <= 1 || !/runner\.os == 'Windows'/.test(block), `one command per Windows step:\n${block}`);
  }
  assert.match(steps, /BONAPARTE_PACKED_REQUIRED/);
});

test('release.yml: the draft release carries the version’s own notes from CHANGELOG.md', () => {
  assert.match(jobs(release).get('draft'), /--notes-file/);
});
