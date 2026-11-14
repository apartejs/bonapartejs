/**
 * The video memory of the card, what a load is announced against. On
 * Windows the display adapters' class in the registry says it
 * (`HardwareInformation.qwMemorySize`, 64-bit); elsewhere it is unknown —
 * never zero.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { SpawnedProcess, SpawnFn } from '../process/spawn.js';
import { readGpuMemoryBytes } from './gpu-memory.js';

/** A PowerShell that prints what the test says, then leaves. */
function answering(output: string, code = 0) {
  const launches: { command: string; args: readonly string[]; options: Parameters<SpawnFn>[2] }[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    launches.push({ command, args, options });
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough(), kill: () => true });
    setImmediate(() => {
      stdout.end(output);
      child.emit('exit', code);
      child.emit('close', code);
    });
    return child as unknown as SpawnedProcess;
  };
  return { spawn, launches };
}

describe('readGpuMemoryBytes', () => {
  it('reads the largest card the registry lists, through a hidden PowerShell', async () => {
    const { spawn, launches } = answering('25769803776\r\n');
    expect(await readGpuMemoryBytes({ platform: 'win32', spawn })).toBe(24 * 1024 ** 3);
    expect(launches[0]!.command).toBe('powershell');
    expect(launches[0]!.options).toMatchObject({ shell: false, windowsHide: true });
    // It reads; it never writes.
    expect(launches[0]!.args.join(' ')).not.toMatch(/Set-ItemProperty|New-Item|Remove-Item/);
  });

  it('is unknown when the registry says nothing', async () => {
    expect(await readGpuMemoryBytes({ platform: 'win32', spawn: answering('').spawn })).toBeNull();
    expect(await readGpuMemoryBytes({ platform: 'win32', spawn: answering('not a number').spawn })).toBeNull();
    expect(await readGpuMemoryBytes({ platform: 'win32', spawn: answering('0').spawn })).toBeNull();
  });

  it('is unknown elsewhere than Windows, and launches nothing', async () => {
    const { spawn, launches } = answering('1');
    expect(await readGpuMemoryBytes({ platform: 'linux', spawn })).toBeNull();
    expect(launches).toHaveLength(0);
  });
});
