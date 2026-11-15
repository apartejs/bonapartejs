/**
 * The terminal's Node half (task 6.6): one session per tab, on a shell the
 * app found. What the shell prints goes to the tab's view as it comes,
 * held while the view is behind; a view that goes away detaches, and the
 * shell's history redraws it when it comes back. Closing a tab kills its
 * shell.
 */

import type { PluginNodeContext, PluginPtyOptions } from '@aparte/bonaparte-plugin-sdk';
import { describe, expect, it } from 'vitest';
import { MAX_HISTORY_CHARS, terminal } from './node.js';

interface FakePty {
  shellId: string;
  options: PluginPtyOptions;
  written: string[];
  size: [number, number];
  killed: boolean;
  /** Its output held by the app (node-pty's pause), until resumed. */
  paused: boolean;
  print(data: string): void;
  exit(code: number): void;
}

function rig(options: { terminals?: boolean } = {}) {
  const ptys: FakePty[] = [];
  const commands = new Map<string, (payload: unknown) => unknown>();
  const sent: { instanceId: string; event: string; payload: unknown }[] = [];
  const drains = new Map<string, () => void>();
  const resets: string[] = [];
  let behind = false;
  const ctx = {
    pluginId: 'terminal',
    registerCommand: (name: string, handler: (payload: unknown) => unknown) => commands.set(name, handler),
    channel: (instanceId: string) => ({
      emit: (event: string, payload: unknown) => {
        sent.push({ instanceId, event, payload });
        return !behind;
      },
      onDrain: (listener: () => void) => drains.set(instanceId, listener),
      reset: () => resets.push(instanceId),
      dispose: () => undefined,
    }),
    onDispose: () => undefined,
    log: () => undefined,
    ...(options.terminals === false
      ? {}
      : {
          terminals: {
            shells: () => [
              { id: 'pwsh', label: 'PowerShell 7' },
              { id: 'cmd', label: 'Invite de commandes' },
            ],
            open: (shellId: string, opts: PluginPtyOptions) => {
              let onData: (data: string) => void = () => undefined;
              let onExit: (code: number | null) => void = () => undefined;
              const pty: FakePty = {
                shellId,
                options: opts,
                written: [],
                size: [opts.cols, opts.rows],
                killed: false,
                paused: false,
                print: (data) => onData(data),
                exit: (code) => onExit(code),
              };
              ptys.push(pty);
              return {
                pid: ptys.length,
                write: (data: string) => pty.written.push(data),
                resize: (cols: number, rows: number) => {
                  pty.size = [cols, rows];
                },
                onData: (listener: (data: string) => void) => {
                  onData = listener;
                },
                onExit: (listener: (code: number | null) => void) => {
                  onExit = listener;
                },
                kill: () => {
                  pty.killed = true;
                },
                pause: () => {
                  pty.paused = true;
                },
                resume: () => {
                  pty.paused = false;
                },
              };
            },
          },
        }),
  } as unknown as PluginNodeContext;
  void terminal.activate(ctx);
  const call = (name: string, payload: unknown) => commands.get(name)!(payload);
  return {
    ptys,
    sent,
    resets,
    call,
    behind: (value: boolean) => {
      behind = value;
    },
    drain: (instanceId: string) => drains.get(instanceId)?.(),
  };
}

const data = (sent: { instanceId: string; event: string; payload: unknown }[], instanceId: string) =>
  sent
    .filter((one) => one.instanceId === instanceId && one.event === 'data')
    .map((one) => one.payload as string)
    .join('');

describe('the terminal plugin', () => {
  it('lists the shells the app found, and opens a tab on the first unless one is chosen', () => {
    const { ptys, call } = rig();
    expect(call('shells', {})).toEqual({
      shells: [
        { id: 'pwsh', label: 'PowerShell 7' },
        { id: 'cmd', label: 'Invite de commandes' },
      ],
    });
    expect(call('open', { instanceId: 't1', cols: 100, rows: 30, cwd: '/project' })).toEqual({ shellId: 'pwsh', history: '', exited: false });
    expect(ptys[0]).toMatchObject({ shellId: 'pwsh', options: { cwd: '/project', cols: 100, rows: 30, env: { TERM: 'xterm-256color' } } });
    call('open', { instanceId: 't2', shellId: 'cmd', cols: 80, rows: 24 });
    expect(ptys[1]!.shellId).toBe('cmd');
  });

  it("what the shell prints goes to its own tab, raw; what the person types and the tab's size go to the shell", () => {
    const { ptys, sent, call } = rig();
    call('open', { instanceId: 't1', cols: 80, rows: 24 });
    call('open', { instanceId: 't2', cols: 80, rows: 24 });
    ptys[0]!.print('\u001b[32mPS C:\\> \u001b[0m');
    expect(data(sent, 't1')).toBe('\u001b[32mPS C:\\> \u001b[0m');
    expect(data(sent, 't2')).toBe('');
    call('write', { instanceId: 't1', data: 'ls\r' });
    call('resize', { instanceId: 't1', cols: 120, rows: 40 });
    expect(ptys[0]!.written).toEqual(['ls\r']);
    expect(ptys[0]!.size).toEqual([120, 40]);
  });

  it('holds what comes while the view is behind, and sends it, in order, once it has caught up', () => {
    const { ptys, sent, call, behind, drain } = rig();
    call('open', { instanceId: 't1', cols: 80, rows: 24 });
    behind(true);
    ptys[0]!.print('one ');
    ptys[0]!.print('two ');
    ptys[0]!.print('three');
    expect(data(sent, 't1')).toBe('one ');
    behind(false);
    drain('t1');
    expect(data(sent, 't1')).toBe('one two three');
  });

  it('a view behind holds its shell, which goes on once the view has caught up: nothing piles up in between', () => {
    const { ptys, sent, call, behind, drain } = rig();
    call('open', { instanceId: 't1', cols: 80, rows: 24 });
    behind(true);
    ptys[0]!.print('one ');
    expect(ptys[0]!.paused).toBe(true);
    behind(false);
    drain('t1');
    expect(ptys[0]!.paused).toBe(false);
    expect(data(sent, 't1')).toBe('one ');
  });

  it('a view that comes back starts its flow afresh, and a shell held for the view that went goes on', () => {
    const { ptys, call, behind, resets } = rig();
    call('open', { instanceId: 't1', cols: 80, rows: 24 });
    behind(true);
    ptys[0]!.print('a lot');
    call('detach', { instanceId: 't1' });
    expect(ptys[0]!.paused).toBe(false);
    behind(false);
    call('open', { instanceId: 't1', cols: 80, rows: 24 });
    expect(resets).toEqual(['t1', 't1']);
  });

  it('a view that goes away detaches: nothing is sent, the history is kept and redraws it when it comes back', () => {
    const { ptys, sent, call } = rig();
    call('open', { instanceId: 't1', cols: 80, rows: 24 });
    ptys[0]!.print('before ');
    call('detach', { instanceId: 't1' });
    ptys[0]!.print('while away');
    expect(data(sent, 't1')).toBe('before ');
    expect(call('open', { instanceId: 't1', cols: 80, rows: 24 })).toEqual({ shellId: 'pwsh', history: 'before while away', exited: false });
    expect(ptys).toHaveLength(1);
    ptys[0]!.print(' again');
    expect(data(sent, 't1')).toBe('before  again');
  });

  it('keeps a bounded history: the end', () => {
    const { ptys, call } = rig();
    call('open', { instanceId: 't1', cols: 80, rows: 24 });
    ptys[0]!.print('x'.repeat(MAX_HISTORY_CHARS));
    ptys[0]!.print('the end');
    call('detach', { instanceId: 't1' });
    const { history } = call('open', { instanceId: 't1', cols: 80, rows: 24 }) as { history: string };
    expect(history).toHaveLength(MAX_HISTORY_CHARS);
    expect(history.endsWith('the end')).toBe(true);
  });

  it('says when the shell exited; opening the tab again starts a new one; closing it kills its shell', () => {
    const { ptys, sent, call } = rig();
    call('open', { instanceId: 't1', cols: 80, rows: 24 });
    ptys[0]!.exit(0);
    expect(sent.at(-1)).toEqual({ instanceId: 't1', event: 'exit', payload: { code: 0 } });
    expect(call('open', { instanceId: 't1', cols: 80, rows: 24 })).toEqual({ shellId: 'pwsh', history: '', exited: false });
    expect(ptys).toHaveLength(2);
    call('close', { instanceId: 't1' });
    expect(ptys[1]!.killed).toBe(true);
  });

  it('without terminals from the app, says so instead of opening one', () => {
    const { call } = rig({ terminals: false });
    expect(call('shells', {})).toEqual({ shells: [] });
    expect(call('open', { instanceId: 't1', cols: 80, rows: 24 })).toEqual({ error: 'no-terminals' });
  });
});
