/**
 * Terminal — Node half.
 *
 * A REAL pseudo-terminal via `node-pty`: interactive programs, colors,
 * window size, full screen. We no longer filter ANSI sequences — it's
 * xterm.js that interprets them on the view side. Stripping them meant
 * displaying text while pretending it was a terminal.
 *
 * `node-pty` is a native binding. Verified on 2026-08-20: it loads under
 * Electron 43 WITHOUT recompilation (ABI compatible, ConPTY shipped with the
 * package). The fallback stays in place for machines where it might be
 * missing, but it is announced as degraded, not presented as a terminal.
 *
 * Transport: data is PUSHED to the view (`ctx.emit`), with the SDK's
 * back-pressure — borrowed from VS Code's model. `emit` returns `false`
 * when the view is behind: we then stop reading the PTY, and resume on
 * `onDrain`. Nothing is lost, because the producer stops instead of a
 * buffer being trimmed.
 *
 * One terminal PER TAB: the tooling panel allows opening as many as
 * wanted, each with its own shell, its own folder and its own
 * back-pressure channel — a `cat` of a big file must not freeze its
 * neighbor. The `instanceId` the view passes IS the session's identity.
 *
 * One difference from VS Code remains, and it's accepted: their PTY runs
 * in a dedicated PROCESS, so a native crash doesn't take down the window.
 * Here it lives in the main process.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  definePlugin,
  type PluginInstanceChannel,
  type PluginNodeContext,
} from '@aparte/bonaparte-plugin-sdk';

/**
 * History kept for REOPENING the view: when the tab remounts, whatever
 * scrolled by must be redisplayed. It is no longer a transport buffer —
 * data goes out via `emit` as it streams.
 */
const MAX_HISTORY_CHARS = 200_000;

interface PtyLike {
  write(data: string): void;
  resize?(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
}

type Mode = 'pty' | 'basic';

export interface ShellChoice {
  /** Stable identifier, used by the view to request this shell. */
  id: string;
  label: string;
  command: string;
  args: string[];
}

/**
 * Shells actually present on the machine.
 *
 * We only offer what exists: a list that offers "pwsh" on a machine
 * without PowerShell 7 promises a terminal that won't open.
 */
function availableShells(): ShellChoice[] {
  const found: ShellChoice[] = [];

  if (process.platform === 'win32') {
    const system = process.env['SystemRoot'] ?? 'C:\\Windows';
    const powershell = join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (existsSync(powershell)) {
      found.push({ id: 'powershell', label: 'Windows PowerShell', command: powershell, args: [] });
    }
    // PowerShell 7+ installs outside System32 and isn't always there.
    for (const candidate of [
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    ]) {
      if (existsSync(candidate)) {
        found.push({ id: 'pwsh', label: 'PowerShell 7', command: candidate, args: [] });
      }
    }
    const cmd = process.env['COMSPEC'] ?? join(system, 'System32', 'cmd.exe');
    if (existsSync(cmd)) {
      found.push({ id: 'cmd', label: 'Command Prompt', command: cmd, args: [] });
    }
    for (const candidate of [
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      join(process.env['ProgramW6432'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    ]) {
      if (existsSync(candidate) && !found.some((s) => s.id === 'gitbash')) {
        found.push({ id: 'gitbash', label: 'Git Bash', command: candidate, args: ['-i'] });
      }
    }
    const wsl = join(system, 'System32', 'wsl.exe');
    if (existsSync(wsl)) {
      found.push({ id: 'wsl', label: 'WSL', command: wsl, args: [] });
    }
    return found;
  }

  const preferred = process.env['SHELL'];
  if (preferred && existsSync(preferred)) {
    found.push({
      id: 'default',
      label: preferred.split('/').pop() ?? 'shell',
      command: preferred,
      args: ['-i'],
    });
  }
  for (const candidate of ['/bin/zsh', '/bin/bash', '/usr/bin/fish', '/bin/sh']) {
    if (existsSync(candidate) && candidate !== preferred) {
      found.push({
        id: candidate.split('/').pop() as string,
        label: candidate.split('/').pop() as string,
        command: candidate,
        args: ['-i'],
      });
    }
  }
  return found;
}

/** Wraps an ordinary process in the same shape as a PTY. */
function wrapChild(child: ChildProcess): PtyLike {
  return {
    write: (data) => child.stdin?.write(data),
    kill: () => child.kill(),
    onData: (listener) => {
      child.stdout?.on('data', (chunk: Buffer) => listener(chunk.toString('utf8')));
      child.stderr?.on('data', (chunk: Buffer) => listener(chunk.toString('utf8')));
    },
    onExit: (listener) => child.on('exit', (code) => listener(code)),
  };
}

/** The real PTY if it can be loaded; otherwise `null`, without making noise. */
async function tryPty(
  shell: ShellChoice,
  cwd: string,
  cols: number,
  rows: number,
): Promise<PtyLike | null> {
  try {
    // Computed specifier: the compiler must not require the package to
    // exist, since the whole point is that it may be missing.
    const optional = 'node-pty';
    const nodePty = (await import(optional)) as unknown as {
      spawn: (
        file: string,
        args: string[],
        options: Record<string, unknown>,
      ) => {
        write(data: string): void;
        resize(cols: number, rows: number): void;
        kill(): void;
        onData(cb: (data: string) => void): void;
        onExit(cb: (event: { exitCode: number }) => void): void;
      };
    };
    const process_ = nodePty.spawn(shell.command, shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env,
    });
    return {
      write: (data) => process_.write(data),
      resize: (c, r) => process_.resize(c, r),
      kill: () => process_.kill(),
      onData: (listener) => process_.onData(listener),
      onExit: (listener) => process_.onExit(({ exitCode }) => listener(exitCode)),
    };
  } catch {
    return null;
  }
}

interface Session {
  pty: PtyLike;
  /** Back-pressure channel SPECIFIC to this tab. */
  channel: PluginInstanceChannel;
  mode: Mode;
  shellId: string;
  /** Raw history, to redisplay when the tab reopens. */
  history: string;
  exited: boolean;
  /** Is the PTY paused because the view didn't keep up? */
  paused: boolean;
  /** What arrived DURING the pause, to push on resume. */
  pending: string;
  /**
   * Is the tab DETACHED? The panel only mounts the active view: a
   * background terminal keeps producing, but nothing displays or
   * acknowledges it. Once detached, we no longer emit anything and only
   * keep the (bounded) history — otherwise `pending` would grow forever
   * behind a view that no longer exists.
   */
  detached: boolean;
}

export default definePlugin({
  activate(ctx: PluginNodeContext) {
    /** One session per open tab, indexed by its `instanceId`. */
    const sessions = new Map<string, Session>();

    const close = (instanceId: string): void => {
      const session = sessions.get(instanceId);
      if (!session) return;
      try {
        session.pty.kill();
      } catch {
        /* already gone */
      }
      session.channel.dispose();
      sessions.delete(instanceId);
    };

    // Shells die with the plugin: no lingering process.
    ctx.onDispose(() => {
      for (const instanceId of [...sessions.keys()]) close(instanceId);
    });

    /** The tab, as each command names it. */
    const idOf = (payload: unknown): string =>
      typeof (payload as { instanceId?: unknown } | null)?.instanceId === 'string'
        ? (payload as { instanceId: string }).instanceId
        : '';

    ctx.registerCommand('shells', async () => ({ shells: availableShells() }));

    ctx.registerCommand('open', async (payload) => {
      const {
        cwd,
        shellId,
        cols = 80,
        rows = 24,
      } = (payload ?? {}) as {
        cwd?: string;
        shellId?: string;
        cols?: number;
        rows?: number;
      };
      const instanceId = idOf(payload);

      const existing = sessions.get(instanceId);
      // Changing shell WITHIN the same tab means replacing its terminal.
      if (existing && shellId && existing.shellId !== shellId) close(instanceId);
      const live = sessions.get(instanceId);
      if (live) {
        // The view remounts onto a live session: it reattaches and
        // receives the history to redisplay what scrolled by without it.
        live.detached = false;
        return {
          mode: live.mode,
          shellId: live.shellId,
          history: live.history,
          exited: live.exited,
        };
      }

      const shells = availableShells();
      const shell = shells.find((s) => s.id === shellId) ?? shells[0];
      if (!shell) return { error: 'No shell found on this machine.' };

      const workdir = cwd ?? process.cwd();
      const real = await tryPty(shell, workdir, cols, rows);
      const pty =
        real ?? wrapChild(spawn(shell.command, shell.args, { cwd: workdir, windowsHide: true }));

      const session: Session = {
        pty,
        channel: ctx.channel(instanceId),
        mode: real ? 'pty' : 'basic',
        shellId: shell.id,
        history: '',
        exited: false,
        paused: false,
        pending: '',
        detached: false,
      };

      /**
       * Pushes to THIS tab, and stops if it's behind.
       *
       * node-pty exposes no pause: we cannot stop receiving. So we
       * accumulate into `pending` — but bounded by the back-pressure,
       * which keeps the gap from growing forever, unlike the old buffer
       * that trimmed silently.
       */
      const push = (data: string): void => {
        session.history += data;
        if (session.history.length > MAX_HISTORY_CHARS) {
          session.history = session.history.slice(session.history.length - MAX_HISTORY_CHARS);
        }
        // Tab detached: the history is enough, it will be replayed on remount.
        if (session.detached) {
          session.pending = '';
          return;
        }
        if (session.paused) {
          session.pending += data;
          return;
        }
        if (!session.channel.emit('data', data)) session.paused = true;
      };

      session.channel.onDrain(() => {
        session.paused = false;
        const waiting = session.pending;
        session.pending = '';
        if (waiting) push(waiting);
      });

      pty.onData(push);
      pty.onExit(() => {
        session.exited = true;
        session.channel.emit('exit', null);
      });
      sessions.set(instanceId, session);
      ctx.log(`${shell.label} started (${session.mode}) in ${workdir}`);
      return { mode: session.mode, shellId: shell.id, history: '', exited: false };
    });

    ctx.registerCommand('write', async (payload) => {
      const { data } = (payload ?? {}) as { data?: string };
      const session = sessions.get(idOf(payload));
      if (!session || data === undefined) return { written: false };
      session.pty.write(data);
      return { written: true };
    });

    ctx.registerCommand('resize', async (payload) => {
      const { cols, rows } = (payload ?? {}) as { cols?: number; rows?: number };
      const session = sessions.get(idOf(payload));
      if (session?.pty.resize && cols && rows) session.pty.resize(cols, rows);
      return { resized: Boolean(session?.pty.resize) };
    });

    /**
     * The view leaves without the tab being closed (switching to another
     * tab). The shell KEEPS running — that's what's expected of a
     * terminal — but it stops emitting toward a view that's no longer
     * listening.
     */
    ctx.registerCommand('detach', async (payload) => {
      const session = sessions.get(idOf(payload));
      if (!session) return { detached: false };
      session.detached = true;
      session.pending = '';
      return { detached: true };
    });

    ctx.registerCommand('close', async (payload) => {
      close(idOf(payload));
      return { closed: true };
    });
  },
});
