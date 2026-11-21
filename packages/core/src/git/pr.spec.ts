/**
 * The pull request of a conversation's branch (task 6.8), through GitHub's
 * CLI — a fake one here: its state and its CI, read; none without the CLI.
 * Opening one (audit 2026-11-21, D7): what goes is said first — the remote,
 * the branch, its commits, what is not committed, a title and a description
 * to start from —; the branch pushed to itself, never forced, never to the
 * default branch; each failure said for what it is. Pushes go to a bare
 * repository of the test: a test never asks GitHub.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { tempRepo, type TempRepo } from '../testing/temp-repo.js';
import { git } from './git.js';
import { ciOf, ghRefusal, openPr, prPlan, prStatus, proposeText, pushRefusal, shownRemoteUrl } from './pr.js';

const FAKE_GH = fileURLToPath(new URL('../testing/fake-gh.mjs', import.meta.url));
const gh = [process.execPath, FAKE_GH];

let dirs: string[] = [];
let repos: TempRepo[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
  for (const repo of repos) await repo.remove();
  dirs = [];
  repos = [];
  delete process.env['FAKE_GH_STATE'];
  delete process.env['FAKE_GH_CALLS'];
  delete process.env['FAKE_GH_FAIL'];
});

async function state(pr?: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-gh-'));
  dirs.push(dir);
  const path = join(dir, 'state.json');
  await writeFile(path, JSON.stringify(pr ? { pr } : {}));
  process.env['FAKE_GH_STATE'] = path;
  process.env['FAKE_GH_CALLS'] = join(dir, 'calls.jsonl');
  return dir;
}

async function calls(dir: string): Promise<string[][]> {
  const text = await readFile(join(dir, 'calls.jsonl'), 'utf8').catch(() => '');
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

/** A repository on its own branch `bonaparte/heures` from main, with `commits` commits, and a bare remote `origin`. */
async function onBranch(commits: string[], options: { remote?: boolean; branch?: string } = {}): Promise<{ dir: string; remote: string }> {
  const repo = await tempRepo({ 'notes.txt': 'first\n' });
  repos.push(repo);
  const remote = await mkdtemp(join(tmpdir(), 'bp-remote-'));
  dirs.push(remote);
  if (options.remote !== false) {
    expect((await git(['init', '-q', '--bare', remote], repo.dir)).code).toBe(0);
    expect((await git(['remote', 'add', 'origin', remote], repo.dir)).code).toBe(0);
  }
  expect((await git(['switch', '-q', '-c', options.branch ?? 'bonaparte/heures'], repo.dir)).code).toBe(0);
  for (const [index, subject] of commits.entries()) {
    await writeFile(join(repo.dir, `file-${index}.txt`), `${subject}\n`);
    expect((await git(['add', '-A'], repo.dir)).code).toBe(0);
    expect((await git(['commit', '-q', '-m', subject], repo.dir)).code).toBe(0);
  }
  return { dir: repo.dir, remote };
}

describe('the pull request of a branch', () => {
  it('reads its state and its CI', async () => {
    const dir = await state({
      number: 42,
      state: 'OPEN',
      url: 'https://github.com/example/project/pull/42',
      statusCheckRollup: [{ conclusion: 'SUCCESS', status: 'COMPLETED' }],
    });
    expect(await prStatus(gh, dir, 'bonaparte/heures')).toEqual({
      number: 42,
      state: 'open',
      url: 'https://github.com/example/project/pull/42',
      ci: 'success',
    });
    expect((await calls(dir))[0]).toEqual(['pr', 'view', 'bonaparte/heures', '--json', 'number,state,url,statusCheckRollup']);
  });

  it('none when the branch has no pull request, or without the CLI', async () => {
    const dir = await state();
    expect(await prStatus(gh, dir, 'bonaparte/heures')).toBeNull();
    expect(await prStatus(null, dir, 'bonaparte/heures')).toBeNull();
    expect(await prStatus(['no-such-gh-command-here'], dir, 'bonaparte/heures')).toBeNull();
  });

  it('says the CI as a person reads it: failed if one failed, running if one runs, passed if all passed', () => {
    expect(ciOf([])).toBeNull();
    expect(ciOf([{ conclusion: 'SUCCESS' }, { conclusion: 'SKIPPED' }])).toBe('success');
    expect(ciOf([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }])).toBe('pending');
    expect(ciOf([{ conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }])).toBe('failure');
    expect(ciOf([{ state: 'PENDING' }])).toBe('pending');
    expect(ciOf([{ state: 'ERROR' }])).toBe('failure');
  });
});

describe('opening a pull request (audit 2026-11-21, D7)', { timeout: 30_000 }, () => {
  it('says what goes first: the remote, the branch, its commits, what is not committed, a title to start from', async () => {
    await state();
    const { dir, remote } = await onBranch(['Count the hours', 'Show the total']);
    await writeFile(join(dir, 'draft.txt'), 'not committed\n');
    const plan = await prPlan(gh, dir, 'bonaparte/heures', 'main', 'Le récap des heures');
    expect(plan).toMatchObject({
      branch: 'bonaparte/heures',
      base: 'main',
      remote: { name: 'origin', url: remote },
      count: 2,
      uncommitted: 1,
      title: 'Le récap des heures',
      body: '- Count the hours\n- Show the total',
    });
    expect(plan.commits.map((commit) => commit.subject)).toEqual(['Show the total', 'Count the hours']);
    expect(plan.refused).toBeUndefined();
    // One commit: its own words.
    expect(proposeText([{ subject: 'Fix the total' }], 'Le récap')).toEqual({ title: 'Fix the total', body: '' });
  });

  it('an address is shown without its user or token', () => {
    expect(shownRemoteUrl('https://paul:ghp_secret@github.com/apartejs/x.git')).toBe('https://github.com/apartejs/x.git');
    expect(shownRemoteUrl('git@github.com:apartejs/x.git')).toBe('git@github.com:apartejs/x.git');
  });

  it('pushes the branch to itself — never forced — then opens its pull request with the person’s title and description', async () => {
    const said = await state();
    const { dir, remote } = await onBranch(['Count the hours']);
    const pushes: string[][] = [];
    const opened = await openPr(gh, dir, 'bonaparte/heures', 'main', { title: 'Récap des heures', body: 'Ce que fait la branche.' }, async (args) => {
      pushes.push(args);
      return git(args, dir);
    });
    expect(opened).toMatchObject({ ok: true, pr: { number: 42, state: 'open' } });
    expect(pushes).toEqual([['push', '--porcelain', '-u', 'origin', 'refs/heads/bonaparte/heures:refs/heads/bonaparte/heures']]);
    for (const args of pushes) {
      expect(args.some((arg) => arg.startsWith('+') || arg.includes(':+') || /^--force|^-f$/.test(arg))).toBe(false);
    }
    // The remote has the branch, with its commit.
    expect((await git(['log', '-1', '--format=%s', 'bonaparte/heures'], remote)).stdout.trim()).toBe('Count the hours');
    const create = (await calls(said)).find((call) => call[0] === 'pr' && call[1] === 'create')!;
    expect(create).toEqual(['pr', 'create', '--base', 'main', '--head', 'bonaparte/heures', '--title', 'Récap des heures', '--body', 'Ce que fait la branche.']);
  });

  it('never to the default branch, nothing without a remote or without a commit: refused before anything goes', async () => {
    const said = await state();
    const never = async () => {
      throw new Error('nothing is pushed');
    };
    const main = await onBranch(['Work'], { branch: 'master' });
    expect((await prPlan(gh, main.dir, 'master', 'main', 'x')).refused).toBe('default-branch');
    expect(await openPr(gh, main.dir, 'master', 'main', { title: 'x', body: '' }, never)).toEqual({ ok: false, reason: 'default-branch', detail: '' });
    const lonely = await onBranch(['Work'], { remote: false });
    expect(await openPr(gh, lonely.dir, 'bonaparte/heures', 'main', { title: 'x', body: '' }, never)).toEqual({ ok: false, reason: 'no-remote', detail: '' });
    const empty = await onBranch([]);
    expect(await openPr(gh, empty.dir, 'bonaparte/heures', 'main', { title: 'x', body: '' }, never)).toEqual({ ok: false, reason: 'no-commits', detail: '' });
    expect(await openPr(null, empty.dir, 'bonaparte/heures', 'main', { title: 'x', body: '' }, never)).toEqual({ ok: false, reason: 'no-gh', detail: '' });
    expect((await calls(said)).filter((call) => call[0] === 'pr')).toEqual([]);
  });

  it('GitHub’s CLI not signed in: said, and nothing pushed', async () => {
    await state();
    process.env['FAKE_GH_FAIL'] = 'auth';
    const { dir } = await onBranch(['Work']);
    const opened = await openPr(gh, dir, 'bonaparte/heures', 'main', { title: 'x', body: '' }, async () => {
      throw new Error('nothing is pushed');
    });
    expect(opened).toEqual({ ok: false, reason: 'gh-auth', detail: 'You are not logged into any GitHub hosts. To log in, run: gh auth login' });
  });

  it('a push the remote rejects is said, with git’s own line; no pull request is asked', async () => {
    const said = await state();
    const { dir, remote } = await onBranch(['Mine']);
    // Someone else's commit is on the remote's branch: a plain push is rejected, and never forced.
    expect((await git(['push', '-q', 'origin', 'main'], dir)).code).toBe(0);
    const other = await mkdtemp(join(tmpdir(), 'bp-other-'));
    dirs.push(other);
    expect((await git(['clone', '-q', remote, other], dir)).code).toBe(0);
    for (const args of [['config', 'user.email', 'o@example.invalid'], ['config', 'user.name', 'Other'], ['switch', '-q', '-c', 'bonaparte/heures', 'origin/main']]) {
      expect((await git(args, other)).code).toBe(0);
    }
    await writeFile(join(other, 'theirs.txt'), 'theirs\n');
    await git(['add', '-A'], other);
    expect((await git(['commit', '-q', '-m', 'Theirs'], other)).code).toBe(0);
    expect((await git(['push', '-q', 'origin', 'bonaparte/heures'], other)).code).toBe(0);

    const opened = await openPr(gh, dir, 'bonaparte/heures', 'main', { title: 'x', body: '' });
    expect(opened).toMatchObject({ ok: false, reason: 'push-rejected' });
    expect(opened && !opened.ok && opened.detail).toBeTruthy();
    expect((await git(['log', '-1', '--format=%s', 'bonaparte/heures'], remote)).stdout.trim()).toBe('Theirs');
    expect((await calls(said)).filter((call) => call[1] === 'create')).toEqual([]);
  });

  it('a pull request already open is said', async () => {
    await state();
    process.env['FAKE_GH_FAIL'] = 'exists';
    const { dir } = await onBranch(['Work']);
    expect(await openPr(gh, dir, 'bonaparte/heures', 'main', { title: 'x', body: '' })).toMatchObject({ ok: false, reason: 'exists' });
  });

  it('reads what git and GitHub’s CLI say into the person’s words', () => {
    expect(pushRefusal(' ! [rejected]        x -> x (fetch first)')).toBe('push-rejected');
    expect(pushRefusal('remote: Permission to a/b.git denied to someone.\nfatal: unable to access: The requested URL returned error: 403')).toBe('push-denied');
    expect(pushRefusal('remote: error: GH006: Protected branch update failed')).toBe('push-denied');
    expect(pushRefusal("fatal: unable to access 'https://github.com/a/b/': Could not resolve host: github.com")).toBe('offline');
    expect(pushRefusal("fatal: 'origin' does not appear to be a git repository")).toBe('no-remote');
    expect(ghRefusal('pull request create failed: GraphQL: No commits between main and x')).toBe('no-commits');
    expect(ghRefusal('To get started with GitHub CLI, please run:  gh auth login')).toBe('gh-auth');
    expect(ghRefusal('something else')).toBe('failed');
  });
});
