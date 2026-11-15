#!/usr/bin/env node
/**
 * A stand-in for GitHub's CLI, for the tests: a test run never asks GitHub.
 * Its pull request lives in a JSON file (`FAKE_GH_STATE`): `pr view` answers
 * it, `pr create` makes one (number 42, open); every call is noted in
 * `FAKE_GH_CALLS` when it is set.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const statePath = process.env.FAKE_GH_STATE;
if (process.env.FAKE_GH_CALLS) appendFileSync(process.env.FAKE_GH_CALLS, `${JSON.stringify(args)}\n`);

const read = () => (statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {});

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
  const state = read();
  state.pr = { number: 42, state: 'OPEN', url: 'https://github.com/example/project/pull/42', statusCheckRollup: [] };
  if (statePath) writeFileSync(statePath, JSON.stringify(state));
  process.stdout.write(`${state.pr.url}\n`);
  process.exit(0);
}

process.stderr.write(`fake gh: ${args.join(' ')} is not known\n`);
process.exit(2);
