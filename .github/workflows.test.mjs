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

test('ci.yml: the end-to-end tests run on Windows only, split over four jobs that run together', () => {
  // Paul, 2026-11-21: one job took 45 minutes (workers: 1). The repository is public: its minutes are free.
  const job = jobs(ci).get('e2e');
  assert.ok(job, 'ci.yml has an e2e job');
  assert.match(job, /runs-on: windows-latest/);
  assert.match(job, /shard: \[1, 2, 3, 4\]/);
  assert.match(job, /playwright test --shard=\$\{\{ matrix\.shard \}\}\/4/);
  assert.doesNotMatch(jobs(ci).get('gate'), /End-to-end/, 'the gate no longer runs them');
  assert.match(jobs(ci).get('release'), /needs: \[gate, e2e\]/);
});

test('release.yml: Windows by default; macOS (×10) and Linux only when asked; a run by hand builds what it checks', () => {
  assert.match(triggers(release), /^ {2}push:\n {4}tags: \['v\*'\]$/m);
  const os = /^ {8}os: (.+)$/m.exec(release);
  assert.ok(os, 'the matrix names its systems');
  assert.match(os[1], /windows-2025-vs2026/);
  // Each system is left out unless asked: macOS and Linux unless a run by hand checks them; Windows only by a run by
  // hand that unchecks it — so that macOS alone does not build and upload Windows again (review of round 6).
  assert.match(release, /- os: \$\{\{ github\.event_name == 'workflow_dispatch' && !inputs\.windows && 'windows-2025-vs2026' \|\| 'none' \}\}/);
  assert.match(release, /- os: \$\{\{ !inputs\.macos && 'macos-latest' \|\| 'none' \}\}/);
  assert.match(release, /- os: \$\{\{ !inputs\.linux && 'ubuntu-latest' \|\| 'none' \}\}/);
  assert.match(release, /^ {6}windows:\n(?: {8}.*\n)*? {8}type: boolean\n(?: {8}.*\n)*? {8}default: true$/m);
  assert.match(release, /^ {6}macos:\n(?: {8}.*\n)*? {8}type: boolean\n(?: {8}.*\n)*? {8}default: false$/m);
  assert.match(release, /^ {6}linux:\n(?: {8}.*\n)*? {8}type: boolean\n(?: {8}.*\n)*? {8}default: false$/m);
});

for (const [file, text] of [['ci.yml', ci], ['release.yml', release]]) {
  test(`${file}: the job's token is never left in a checkout for every later step to read (review of round 6)`, () => {
    const checkouts = [...text.matchAll(/^( *)- uses: actions\/checkout@.*\n((?:\1 {2}.*\n)*)/gm)];
    assert.ok(checkouts.length > 0);
    for (const [, , body] of checkouts) assert.match(body, /^\s+persist-credentials: false$/m);
  });
}

test('release.yml: a tag publishes into a release still a draft — checked before anything is built (review of round 6)', () => {
  const steps = jobs(release).get('installer');
  const check = steps.indexOf('- name: Check the release is still a draft');
  assert.ok(check > 0 && check < steps.indexOf('Install dependencies'), 'the draft is checked first');
  assert.match(steps.slice(check, steps.indexOf('- name:', check + 1)), /isDraft/);
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

// Paul, 2026-11-21 (« gère la CI, je ne vais pas regarder à chaque fois »): a version new on a green main is tagged
// and its release built, with no one to push the tag. A tag pushed with GitHub's token runs no workflow; a dispatch
// does.
test('ci.yml: a green main tags its version once, and dispatches the release on that tag', () => {
  const job = jobs(ci).get('release');
  assert.ok(job, 'ci.yml has a release job');
  assert.match(job, /needs: \[gate, e2e\]/);
  assert.match(job, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(job, /contents: write/);
  assert.match(job, /actions: write/);
  assert.match(job, /git\/ref\/tags\/\$tag/, 'an existing tag is left alone');
  assert.match(job, /CHANGELOG\.md/, 'a version without notes is not tagged');
  assert.match(job, /gh workflow run release\.yml .*--ref "\$tag"/);
});
