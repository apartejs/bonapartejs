/**
 * What the supervisor asks the system about a process it wrote down in an
 * earlier life, and how it reads the engine's version — both through
 * spawnHidden. These tests ask about real processes of their own.
 */

import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnHidden, type SpawnedProcess } from '../process/spawn.js';
import { defaultProcessProbe, readBuildTag } from './process-probe.js';

const BIN = fileURLToPath(new URL('../testing/fake-llama-bin.mjs', import.meta.url));

let children: SpawnedProcess[] = [];
afterEach(() => {
  for (const child of children) if (child.exitCode === null) child.kill();
  children = [];
});

/** A process that waits, with a marker on its command line. */
function waiting(marker: string): SpawnedProcess {
  const child = spawnHidden(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', marker], { stdio: 'ignore' });
  children.push(child);
  return child;
}

describe('defaultProcessProbe', () => {
  it('reads the command line of a running process', async () => {
    // Not a dashed option: Node would take it for one of its own, and leave.
    const child = waiting('slot-save-path=probe-marker-1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(child.exitCode).toBeNull();
    expect(await defaultProcessProbe.commandLine(child.pid!)).toContain('probe-marker-1');
  }, 20_000);

  it('says null for a process that is not there', async () => {
    const child = waiting('gone');
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
    expect(await defaultProcessProbe.commandLine(child.pid!)).toBeNull();
  }, 20_000);

  it('brings a process down', async () => {
    const child = waiting('to-kill');
    const exited = new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await defaultProcessProbe.kill(child.pid!);
    await exited;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  }, 20_000);
});

describe('readBuildTag', () => {
  it("is the first line of the engine's --version", async () => {
    expect(await readBuildTag(process.execPath, [BIN, '--version'])).toBe('version: 9999 (fake)');
  });

  it("is 'unknown' when the engine cannot say", async () => {
    expect(await readBuildTag('no-such-program-anywhere', ['--version'])).toBe('unknown');
  });
});
