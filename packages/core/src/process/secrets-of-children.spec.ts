/**
 * Security rule 10, audit of phase 13: what bonaparte launches on its own — git (and the hooks a repository makes it
 * run), GitHub's CLI, the short probes of llama.cpp and tar, a plugin's own processes — never inherits the app's
 * secrets. GitHub's CLI keeps its own token: it is what it signs in with.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '../git/git.js';
import { ghEnvironment } from '../git/pr.js';
import { runShort } from '../engine/process-probe.js';
import type { SpawnFn } from './spawn.js';

const dirs: string[] = [];
afterEach(async () => {
  delete process.env['BP_AUDIT_TOKEN'];
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the secrets of what bonaparte launches (audit 13.4)', () => {
  it('git — and a hook or an alias it runs — never sees a secret of the app', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-secret-'));
    dirs.push(dir);
    process.env['BP_AUDIT_TOKEN'] = 'sk-leaked';
    // An alias runs a program as a hook would, in git's own environment.
    const ran = await git(['-c', `alias.bpenv=!node -e "process.stdout.write(process.env.BP_AUDIT_TOKEN ?? 'none')"`, 'bpenv'], dir);
    expect(ran.stdout).toBe('none');
  }, 20_000);

  it('GitHub’s CLI keeps its own token and nothing else of the kind', () => {
    const env = ghEnvironment({ PATH: '/bin', GH_TOKEN: 'gho_1', GITHUB_TOKEN: 'ghp_2', GH_HOST: 'github.com', OPENAI_API_KEY: 'sk-x', AWS_SECRET_ACCESS_KEY: 'y' });
    expect(env).toMatchObject({ PATH: '/bin', GH_TOKEN: 'gho_1', GITHUB_TOKEN: 'ghp_2', GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' });
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
  });

  it('a short probe (llama.cpp --version, tar) is given the app’s environment without its secrets', async () => {
    process.env['BP_AUDIT_TOKEN'] = 'sk-leaked';
    let given: NodeJS.ProcessEnv | undefined;
    const spawn: SpawnFn = (_command, _args, options) => {
      given = options.env;
      throw new Error('stop: only the environment is looked at');
    };
    await runShort('llama-server', ['--version'], 1000, spawn);
    expect(given).toBeDefined();
    expect(given).not.toHaveProperty('BP_AUDIT_TOKEN');
    expect(given?.['PATH'] ?? given?.['Path']).toBeDefined();
  });
});
