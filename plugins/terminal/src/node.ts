/**
 * The terminal's Node half (task 6.6): one session per tab, on one of the
 * shells the app found — the plugin chooses a shell by its id, never names
 * an executable. What the shell prints goes to its tab's view raw (the
 * view's emulator reads the escapes), as it comes, held while the view is
 * behind (the host's back-pressure). A view that goes away detaches: its
 * shell runs on, its output kept in a bounded history that redraws the
 * view when it comes back. Closing a tab kills its shell; everything else
 * goes with the plugin.
 */

import { definePlugin, type PluginInstanceChannel, type PluginPty } from '@aparte/bonaparte-plugin-sdk';

/** The end of a tab's output a view gets back when it comes back. */
export const MAX_HISTORY_CHARS = 200_000;

/** What the shell is told it runs in: a terminal of colours. */
const TERMINAL_ENV = { TERM: 'xterm-256color', COLORTERM: 'truecolor' };

interface Session {
  pty: PluginPty;
  channel: PluginInstanceChannel;
  shellId: string;
  history: string;
  exited: boolean;
  /** The view is behind: what comes waits here. */
  paused: boolean;
  pending: string;
  /** No view: nothing is sent, the history keeps it. */
  detached: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const text = (payload: Record<string, unknown>, key: string): string | undefined =>
  typeof payload[key] === 'string' && payload[key] !== '' ? (payload[key] as string) : undefined;
const size = (payload: Record<string, unknown>, key: string, fallback: number): number => {
  const value = payload[key];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1000 ? value : fallback;
};

export const terminal = definePlugin({
  activate(ctx) {
    const sessions = new Map<string, Session>();

    const send = (session: Session, data: string): void => {
      if (session.detached) return;
      if (session.paused) {
        session.pending += data;
        return;
      }
      if (!session.channel.emit('data', data)) session.paused = true;
    };

    const open = (instanceId: string, shellId: string, payload: Record<string, unknown>): Session => {
      const terminals = ctx.terminals!;
      const pty = terminals.open(shellId, {
        cols: size(payload, 'cols', 80),
        rows: size(payload, 'rows', 24),
        env: TERMINAL_ENV,
        ...(text(payload, 'cwd') ? { cwd: text(payload, 'cwd')! } : {}),
      });
      const channel = ctx.channel(instanceId);
      const session: Session = { pty, channel, shellId, history: '', exited: false, paused: false, pending: '', detached: false };
      pty.onData((data) => {
        session.history = (session.history + data).slice(-MAX_HISTORY_CHARS);
        send(session, data);
      });
      pty.onExit((code) => {
        session.exited = true;
        if (!session.detached) channel.emit('exit', { code });
      });
      channel.onDrain(() => {
        session.paused = false;
        const pending = session.pending;
        session.pending = '';
        if (pending) send(session, pending);
      });
      sessions.set(instanceId, session);
      return session;
    };

    const withSession = (payload: unknown, act: (session: Session, input: Record<string, unknown>) => unknown): unknown => {
      if (!isRecord(payload)) return { error: 'bad-payload' };
      const instanceId = text(payload, 'instanceId');
      const session = instanceId ? sessions.get(instanceId) : undefined;
      return session ? act(session, payload) : { error: 'no-session' };
    };

    ctx.registerCommand('shells', () => ({ shells: ctx.terminals ? [...ctx.terminals.shells()] : [] }));

    ctx.registerCommand('open', (payload) => {
      if (!ctx.terminals) return { error: 'no-terminals' };
      if (!isRecord(payload)) return { error: 'bad-payload' };
      const instanceId = text(payload, 'instanceId');
      if (!instanceId) return { error: 'bad-payload' };
      const live = sessions.get(instanceId);
      // The tab comes back to its shell: the history redraws it, and its output flows again.
      if (live && !live.exited) {
        live.detached = false;
        live.paused = false;
        live.pending = '';
        return { shellId: live.shellId, history: live.history, exited: false };
      }
      live?.channel.dispose();
      const shells = ctx.terminals.shells();
      const chosen = text(payload, 'shellId');
      const shellId = shells.some((shell) => shell.id === chosen) ? chosen! : shells[0]?.id;
      if (!shellId) return { error: 'no-shell' };
      const session = open(instanceId, shellId, payload);
      return { shellId: session.shellId, history: '', exited: false };
    });

    ctx.registerCommand('write', (payload) =>
      withSession(payload, (session, input) => {
        const data = text(input, 'data');
        if (data && !session.exited) session.pty.write(data);
        return { written: Boolean(data) };
      }),
    );

    ctx.registerCommand('resize', (payload) =>
      withSession(payload, (session, input) => {
        if (!session.exited) session.pty.resize(size(input, 'cols', 80), size(input, 'rows', 24));
        return { resized: true };
      }),
    );

    // The view went away (another pane, the window hidden): the shell runs on, its output kept.
    ctx.registerCommand('detach', (payload) =>
      withSession(payload, (session) => {
        session.detached = true;
        session.paused = false;
        session.pending = '';
        return { detached: true };
      }),
    );

    ctx.registerCommand('close', (payload) =>
      withSession(payload, (session, input) => {
        if (!session.exited) session.pty.kill();
        session.channel.dispose();
        sessions.delete(text(input, 'instanceId')!);
        return { closed: true };
      }),
    );
  },
});
