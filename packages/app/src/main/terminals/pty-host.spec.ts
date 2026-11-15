/**
 * The app's terminals (task 6.6): node-pty runs in a process of its own —
 * a native crash there never takes the app, nor the model, down. One
 * process for every terminal, started at the first; a terminal is opened on
 * a shell the app found, with the app's environment minus its secrets; when
 * the process dies, every terminal says it ended, and the next one starts
 * the process again.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createTerminalService, type PtyProcess } from './pty-host.js';
import type { ShellEntry } from './shells.js';

const SHELLS: ShellEntry[] = [
  { id: 'bash', label: 'bash', file: '/bin/bash', args: ['-i'] },
  { id: 'sh', label: 'sh', file: '/bin/sh', args: ['-i'] },
];

function fakeProcess(): PtyProcess & { posted: Record<string, unknown>[]; say(message: unknown): void; die(): void; killed: boolean } {
  const events = new EventEmitter();
  const child = {
    pid: 4242,
    posted: [] as Record<string, unknown>[],
    killed: false,
    postMessage: (message: unknown) => child.posted.push(message as Record<string, unknown>),
    on: (event: string, listener: (...args: never[]) => void) => {
      events.on(event, listener as (...args: unknown[]) => void);
      return child;
    },
    kill: () => {
      child.killed = true;
      return true;
    },
    say: (message: unknown) => events.emit('message', message),
    die: () => events.emit('exit', 1),
  };
  return child as never;
}

function rig() {
  const started: ReturnType<typeof fakeProcess>[] = [];
  const service = createTerminalService({
    shells: () => SHELLS,
    start: () => {
      const child = fakeProcess();
      started.push(child);
      return child;
    },
    env: () => ({ PATH: '/usr/bin', HOME: '/home/paul' }),
    home: '/home/paul',
  });
  return { service, started };
}

describe('the app’s terminals', () => {
  it('lists the shells by id and label only; opens one in the process, started at the first terminal', () => {
    const { service, started } = rig();
    expect(service.shells()).toEqual([
      { id: 'bash', label: 'bash' },
      { id: 'sh', label: 'sh' },
    ]);
    expect(started).toHaveLength(0);
    service.open('sh', { cols: 80, rows: 24, cwd: '/project', env: { TERM: 'xterm-256color' } });
    expect(started).toHaveLength(1);
    expect(started[0]!.posted[0]).toMatchObject({
      type: 'open',
      file: '/bin/sh',
      args: ['-i'],
      cwd: '/project',
      cols: 80,
      rows: 24,
      env: { PATH: '/usr/bin', HOME: '/home/paul', TERM: 'xterm-256color' },
    });
    service.open('bash', { cols: 80, rows: 24 });
    expect(started).toHaveLength(1);
    expect(started[0]!.posted[1]).toMatchObject({ type: 'open', file: '/bin/bash', cwd: '/home/paul' });
  });

  it('refuses a shell it did not find', () => {
    const { service } = rig();
    expect(() => service.open('/bin/evil', { cols: 80, rows: 24 })).toThrow(/no shell/i);
  });

  it('carries what is typed, the size and the kill to the process; what a terminal prints, and its end, back', () => {
    const { service, started } = rig();
    const pty = service.open('bash', { cols: 80, rows: 24 });
    const id = started[0]!.posted[0]!['id'];
    const printed: string[] = [];
    const ended: (number | null)[] = [];
    pty.onData((data) => printed.push(data));
    pty.onExit((code) => ended.push(code));
    pty.write('ls\r');
    pty.resize(120, 40);
    expect(started[0]!.posted.slice(1)).toEqual([
      { type: 'write', id, data: 'ls\r' },
      { type: 'resize', id, cols: 120, rows: 40 },
    ]);
    started[0]!.say({ type: 'data', id, data: 'hello' });
    started[0]!.say({ type: 'data', id: 'other', data: 'not mine' });
    expect(printed).toEqual(['hello']);
    pty.kill();
    expect(started[0]!.posted.at(-1)).toEqual({ type: 'kill', id });
    started[0]!.say({ type: 'exit', id, code: 0 });
    expect(ended).toEqual([0]);
    // Ended: nothing more goes to the process for it.
    pty.write('late');
    expect(started[0]!.posted.at(-1)).toEqual({ type: 'kill', id });
  });

  it('when the process dies, every terminal ends, and the next one starts it again', () => {
    const { service, started } = rig();
    const ended: (number | null)[] = [];
    service.open('bash', { cols: 80, rows: 24 }).onExit((code) => ended.push(code));
    service.open('sh', { cols: 80, rows: 24 }).onExit((code) => ended.push(code));
    started[0]!.die();
    expect(ended).toEqual([null, null]);
    service.open('bash', { cols: 80, rows: 24 });
    expect(started).toHaveLength(2);
  });
});
