/**
 * A process started for someone (a plugin) is stopped with everything it
 * started in turn: killing the parent alone leaves its children running.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { spawnTree, stopProcessTree } from './tree.js';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean, ms = 8_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

const strays: number[] = [];
afterEach(() => {
  for (const pid of strays.splice(0)) if (alive(pid)) process.kill(pid);
});

describe('stopping a process tree', () => {
  it('stops the process and the child it started', async () => {
    // The parent starts a child that would outlive it, hidden, and says its pid. On Windows a child of
    // Node dies with it (libuv's job object): detached, it breaks away from that job, as the child of a
    // program that is not Node would be — and without a console (DETACHED_PROCESS), so no window.
    const detached = process.platform === 'win32';
    const parent = spawnTree(process.execPath, [
      '-e',
      `const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true, detached: ${detached} }); process.stdout.write(String(c.pid) + String.fromCharCode(10)); setInterval(() => {}, 1000);`,
    ]);
    // The pid's whole line, uncoloured (a test runner may force colours on its children).
    const said = await new Promise<string>((resolve) => {
      let text = '';
      parent.stdout!.on('data', (chunk: Buffer) => {
        text += chunk.toString();
        if (text.includes('\n')) resolve(text);
      });
    });
    const childPid = Number.parseInt(said, 10);
    strays.push(childPid, parent.pid!);
    expect(Number.isInteger(childPid), `the parent said: ${JSON.stringify(said)}`).toBe(true);
    expect(await until(() => alive(childPid), 3_000)).toBe(true);

    await stopProcessTree(parent);

    expect(parent.exitCode !== null || parent.signalCode !== null).toBe(true);
    expect(await until(() => !alive(childPid))).toBe(true);
  });

  it('does nothing for a process that already ended', async () => {
    const done = spawnTree(process.execPath, ['-e', '0']);
    await new Promise((resolve) => done.once('exit', resolve));
    await expect(stopProcessTree(done)).resolves.toBeUndefined();
  });
}, 30_000);
