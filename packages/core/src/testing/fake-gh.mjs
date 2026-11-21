#!/usr/bin/env node
/**
 * A stand-in for GitHub's CLI, for the tests: a test run never asks GitHub.
 * Its pull request lives in a JSON file (`FAKE_GH_STATE`): `pr view` answers
 * it, `pr create` makes one (number 42, open, with the title it was given);
 * `auth status` says it is signed in. Every call is noted in `FAKE_GH_CALLS`
 * when it is set. `FAKE_GH_FAIL` makes it fail as GitHub's CLI does: `auth`
 * (not signed in), `exists` (a pull request is already open).
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const statePath = process.env.FAKE_GH_STATE;
if (process.env.FAKE_GH_CALLS) appendFileSync(process.env.FAKE_GH_CALLS, `${JSON.stringify(args)}\n`);

const read = () => (statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {});

const fail = process.env.FAKE_GH_FAIL;

if (args[0] === 'auth' && args[1] === 'status') {
  if (fail === 'auth') {
    process.stderr.write('You are not logged into any GitHub hosts. To log in, run: gh auth login\n');
    process.exit(1);
  }
  process.stdout.write('github.com\n  Logged in to github.com account example (keyring)\n');
  process.exit(0);
}

if (args[0] === 'pr' && args[1] === 'view') {
  const { pr } = read();
  if (!pr) {
    process.stderr.write('no pull requests found for branch\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(pr));
  process.exit(0);
}

if (args[0] === 'pr' && args[1] === 'create') {
  if (fail === 'exists') {
    process.stderr.write('a pull request for branch "x" into branch "main" already exists:\nhttps://github.com/example/project/pull/41\n');
    process.exit(1);
  }
  const state = read();
  const title = args[args.indexOf('--title') + 1];
  state.pr = { number: 42, state: 'OPEN', url: 'https://github.com/example/project/pull/42', statusCheckRollup: [], ...(args.includes('--title') ? { title } : {}) };
  if (statePath) writeFileSync(statePath, JSON.stringify(state));
  process.stdout.write(`${state.pr.url}\n`);
  process.exit(0);
}

process.stderr.write(`fake gh: ${args.join(' ')} is not known\n`);
process.exit(2);
