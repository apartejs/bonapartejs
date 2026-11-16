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
  badge: { kind: 'waiting' | 'failure'; text: string } | null;
}

export interface AttentionDeps {
  words(): MainWords;
  setting(event: NotifyEvent): Promise<NotifySetting>;
  /** The window is in front of the person. */
  focused(): boolean;
  now(): number;
  /** The conversations that wait for the person (« À traiter »'s approvals and questions). */
  waiting(): Promise<Waiting[]>;
  /** The engine, as the menu shows it; null when no model is known. */
  engine(): Promise<EngineRow | null>;
  /** A banner of the system. */
  show(note: Note): void;
  /** The icon, its menu, the badge. */
  render(view: AttentionView): void;
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

  // One drawing at a time, in the order asked: a slow read never draws over a newer state.
  let drawing: Promise<void> = Promise.resolve();
  const refresh = (): Promise<void> => {
    drawing = drawing.then(draw, draw);
    return drawing;
  };

  async function draw(): Promise<void> {
    const [waiting, engine, approval, question, failure] = await Promise.all([
      deps.waiting(),
      deps.engine(),
      deps.setting('approval'),
      deps.setting('question'),
      deps.setting('failure'),
    ]);
    const words = deps.words().badge;
    // What the person turned off makes no sign; it stays listed in the menu, and in « À traiter ».
    const approvals = approval !== 'off' && waiting.some((one) => one.what === 'approval');
    const questions = question !== 'off' && waiting.some((one) => one.what === 'question');
    const failing = failed !== null && failure !== 'off';
    const badge: AttentionView['badge'] = failing
      ? { kind: 'failure', text: words.failed }
      : approvals
        ? { kind: 'waiting', text: words.approval }
        : questions
          ? { kind: 'waiting', text: words.question }
          : null;
    deps.render({
      icon: trayIcon({ failed: failing, waiting: approvals || questions, asleep: engine?.status === 'asleep' }),
      badge,
      waiting,
      engine,
      quietUntil: quiet(),
    });
  }

  return {
    async turnEnded(end) {
      const setting = await deps.setting(EVENT_OF[end.how]);
      const delivery = decide({ setting, focused: deps.focused(), quietUntil: quiet(), now: deps.now() });
      if (delivery === 'banner') deps.show({ ...notificationOf(end, deps.words().notify), conversationId: end.conversationId });
      if (end.how === 'failed') failed = end.conversationId;
      else if (failed === end.conversationId) failed = null;
      await refresh();
    },
    refresh,
    async toggleQuiet() {
      quietUntil = quiet() === null ? deps.now() + QUIET_MS : null;
      await refresh();
    },
    async focused() {
      if (failed === null) return;
      failed = null;
      await refresh();
    },
  };
}
