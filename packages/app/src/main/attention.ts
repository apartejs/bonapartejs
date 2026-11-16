/**
 * Being noticed when the window is not in front of the person (task 8.5, board « Notifications et zone de
 * notification »). A turn that ends becomes a banner by the person's setting for its event, the window's focus and
 * « Ne pas déranger » (`decide`); the icon of the notification area and the taskbar's badge say what waits — an
 * approval, an answer — or that the engine failed, as long as it is true; « Ne pas déranger » keeps the banners
 * for « À traiter » for an hour. A banner opens its conversation: an approval is never given from here.
 *
 * Everything Electron does is behind `show` and `render`: this is decided here, tested without it.
 */

import type { TurnEnd } from '@aparte/bonaparte-core';
import type { MainWords } from './i18n/index.js';
import { decide, EVENT_OF, notificationOf, type NotifyEvent, type NotifySetting } from './notifications.js';
import { trayIcon, type EngineRow, type TrayIcon, type TrayView, type Waiting } from './tray.js';

/** « Ne pas déranger pendant 1 h ». */
const QUIET_MS = 3_600_000;

export interface Note {
  title: string;
  body: string;
  conversationId: string;
}

export interface AttentionView extends TrayView {
  icon: TrayIcon;
  /** The taskbar's badge and what it says; null for none. */
  badge: { kind: 'waiting' | 'failure' | 'done'; text: string } | null;
}

export interface AttentionDeps {
  words(): MainWords;
  setting(event: NotifyEvent): Promise<NotifySetting>;
  /** The window is in front of the person. */
  focused(): boolean;
  now(): number;
  /** What waits for the person (« À traiter »): the conversations waiting on an answer, and the replies not read. */
  waiting(): Promise<{ rows: Waiting[]; unread: number }>;
  /** The engine, as the menu shows it; null when no model is known. */
  engine(): Promise<EngineRow | null>;
  /** A banner of the system. */
  show(note: Note): void;
  /** The icon, its menu, the badge. */
  render(view: AttentionView): void;
  /** Where a failure goes: the app goes on whatever a read or a drawing does. */
  log?(message: string): void;
  /** Runs `run` in `ms` (« Ne pas déranger » ends by itself). */
  later?(ms: number, run: () => void): void;
}

export interface Attention {
  turnEnded(end: TurnEnd): Promise<void>;
  /** What waits may have changed (an answer given, the engine loaded or let go): the icon and the menu again. */
  refresh(): Promise<void>;
  /** « Ne pas déranger pendant 1 h », or its end when it is on. */
  toggleQuiet(): Promise<void>;
  /** The person came back to the window: a failure was seen. */
  focused(): Promise<void>;
}

export function createAttention(deps: AttentionDeps): Attention {
  let quietUntil: number | null = null;
  /** The conversation whose turn failed, until the person comes back to the window or it answers again. */
  let failed: string | null = null;
  const quiet = (): number | null => (quietUntil !== null && deps.now() < quietUntil ? quietUntil : (quietUntil = null));

  const log = (message: string, error: unknown): void => {
    (deps.log ?? console.error)(`[bonaparte] ${message}: ${error instanceof Error ? error.message : String(error)}`);
  };

  // One drawing at a time, in the order asked: a slow read never draws over a newer state. A drawing that fails
  // is said in the log and the last one stays: one unreadable journal never stops the app (review of phase 8).
  let drawing: Promise<void> = Promise.resolve();
  const refresh = (): Promise<void> => {
    drawing = drawing.then(draw).catch((error: unknown) => log('the notification area was not drawn', error));
    return drawing;
  };

  async function draw(): Promise<void> {
    const [waiting, engine, approval, question, failure, replyDone] = await Promise.all([
      deps.waiting(),
      deps.engine(),
      deps.setting('approval'),
      deps.setting('question'),
      deps.setting('failure'),
      deps.setting('replyDone'),
    ]);
    const words = deps.words().badge;
    // What the person turned off makes no sign; it stays listed in the menu, and in « À traiter ».
    const approvals = approval !== 'off' && waiting.rows.some((one) => one.what === 'approval');
    const questions = question !== 'off' && waiting.rows.some((one) => one.what === 'question');
    const failing = failed !== null && failure !== 'off';
    // A reply ready and not read yet: the badge says it — « Pastille » means that, a banner comes with it.
    const ready = replyDone !== 'off' && waiting.unread > 0;
    const badge: AttentionView['badge'] = failing
      ? { kind: 'failure', text: words.failed }
      : approvals
        ? { kind: 'waiting', text: words.approval }
        : questions
          ? { kind: 'waiting', text: words.question }
          : ready
            ? { kind: 'done', text: words.done(waiting.unread) }
            : null;
    deps.render({
      icon: trayIcon({ failed: failing, waiting: approvals || questions, asleep: engine?.status === 'asleep' }),
      badge,
      waiting: waiting.rows,
      engine,
      quietUntil: quiet(),
    });
  }

  /** Whatever happens in it, a call from the main process never rejects: logged, the app goes on. */
  const safely =
    <A extends unknown[]>(what: string, act: (...args: A) => Promise<void>) =>
    (...args: A): Promise<void> =>
      act(...args).catch((error: unknown) => log(what, error));

  return {
    turnEnded: safely('a notification failed', async (end: TurnEnd) => {
      const setting = await deps.setting(EVENT_OF[end.how]);
      const delivery = decide({ setting, focused: deps.focused(), quietUntil: quiet(), now: deps.now() });
      if (delivery === 'banner') deps.show({ ...notificationOf(end, deps.words().notify), conversationId: end.conversationId });
      if (end.how === 'failed') failed = end.conversationId;
      else if (failed === end.conversationId) failed = null;
      await refresh();
    }),
    refresh,
    toggleQuiet: safely('« Ne pas déranger » failed', async () => {
      quietUntil = quiet() === null ? deps.now() + QUIET_MS : null;
      // The hour over, the menu says so by itself.
      if (quietUntil !== null) (deps.later ?? laterByTimer)(QUIET_MS, () => void refresh());
      await refresh();
    }),
    focused: safely('the window came back, not the notification area', async () => {
      if (failed === null) return;
      failed = null;
      await refresh();
    }),
  };
}

/** A timer that keeps nothing alive: the app quits whenever it wants. */
function laterByTimer(ms: number, run: () => void): void {
  setTimeout(run, ms).unref?.();
}
