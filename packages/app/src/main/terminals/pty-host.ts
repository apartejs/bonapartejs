/**
 * The app's terminals (task 6.6): node-pty runs in a process of its own (an
 * Electron utility process) — a native crash there never takes the app, nor
 * the loaded model, down. One process for every terminal, started with the
 * first; a terminal opens on a shell the app found (by its id), with the
 * app's environment minus its secrets, plus what the plugin adds. When the
 * process dies, every terminal ends; the next one starts it again.
 */

import type { PluginPty, PluginPtyOptions, PluginShell, TerminalService } from '@aparte/bonaparte-shared';
import type { ShellEntry } from './shells.js';

/** The process the terminals run in, as the app talks to it. */
export interface PtyProcess {
  readonly pid?: number | undefined;
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

/** What goes to the process. */
export type ToPty =
  | { type: 'open'; id: string; file: string; args: string[]; cwd: string; cols: number; rows: number; env: Record<string, string> }
  | { type: 'write'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'kill'; id: string };

/** What comes back. */
export type FromPty = { type: 'data'; id: string; data: string } | { type: 'exit'; id: string; code: number | null };

export interface TerminalServiceOptions {
  shells(): readonly ShellEntry[];
  /** Starts the process (a utility process; a fake in tests). */
  start(): PtyProcess;
  /** The app's environment, its secrets taken out. */
  env(): Record<string, string>;
  /** Where a terminal opens without a folder. */
  home: string;
  log?(message: string): void;
}

interface Live {
  data: ((data: string) => void)[];
  exit: ((code: number | null) => void)[];
}

export function createTerminalService(options: TerminalServiceOptions): TerminalService & { process(): PtyProcess | undefined } {
  let child: PtyProcess | undefined;
  const live = new Map<string, Live>();
  let next = 0;

  const end = (id: string, code: number | null): void => {
    const terminal = live.get(id);
    if (!terminal) return;
    live.delete(id);
    for (const listener of terminal.exit) listener(code);
  };

  const processOf = (): PtyProcess => {
    if (child) return child;
    const started = options.start();
    started.on('message', (message) => {
      const said = message as FromPty;
      if (said?.type === 'data') for (const listener of live.get(said.id)?.data ?? []) listener(said.data);
      else if (said?.type === 'exit') end(said.id, said.code);
    });
    started.on('exit', (code) => {
      if (child === started) child = undefined;
      options.log?.(`[bonaparte] the terminals' process ended (${code}); its terminals with it`);
      for (const id of [...live.keys()]) end(id, null);
    });
    child = started;
    return started;
  };

  const post = (message: ToPty): void => processOf().postMessage(message);

  return {
    process: () => child,

    shells: (): PluginShell[] => options.shells().map((shell) => ({ id: shell.id, label: shell.label })),

    open(shellId: string, settings: PluginPtyOptions): PluginPty {
      const shell = options.shells().find((candidate) => candidate.id === shellId);
      if (!shell) throw new Error(`There is no shell ${shellId} on this machine.`);
      const id = `pty-${++next}`;
      const terminal: Live = { data: [], exit: [] };
      live.set(id, terminal);
      post({
        type: 'open',
        id,
        file: shell.file,
        args: shell.args,
        cwd: settings.cwd ?? options.home,
        cols: settings.cols,
        rows: settings.rows,
        env: { ...options.env(), ...settings.env },
      });
      return {
        pid: 0,
        write: (data) => {
          if (live.has(id)) post({ type: 'write', id, data });
        },
        resize: (cols, rows) => {
          if (live.has(id)) post({ type: 'resize', id, cols, rows });
        },
        onData: (listener) => {
          terminal.data.push(listener);
        },
        onExit: (listener) => {
          terminal.exit.push(listener);
        },
        kill: () => {
          if (live.has(id) && child) child.postMessage({ type: 'kill', id } satisfies ToPty);
        },
      };
    },
  };
}
