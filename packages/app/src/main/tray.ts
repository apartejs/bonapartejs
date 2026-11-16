/**
 * The notification area (task 5.9, completed by 8.5; board « Notifications et zone de notification »). Its menu:
 * the app and what waits for the person; « Ouvrir bonaparte »; each conversation that waits — it opens on it,
 * it is never answered from here; the engine, its state and its video memory; « Libérer le modèle »; « Ne pas
 * déranger pendant 1 h »; « Quitter » — the engine stopped, the memory saved. A click on the icon opens the window.
 *
 * Its icon is the bicorne in four colours: at rest, the person waited for, a failure, the model asleep.
 *
 * A test run puts no icon in the person's notification area: it gets the menu, to drive it.
 */

import type { MenuItemConstructorOptions } from 'electron';
import type { MainWords } from './i18n/index.js';

export type TrayIcon = 'rest' | 'waiting' | 'failure' | 'asleep';

/** A conversation that waits for the person: an approval (a sub-agent's included), or an answer. */
export interface Waiting {
  conversationId: string;
  title: string;
  what: 'approval' | 'question';
}

export interface EngineRow {
  name: string;
  status: 'ready' | 'starting' | 'asleep' | 'stopped';
  /** What the model takes of video memory, once known. */
  vramBytes: number | null;
}

export interface TrayView {
  waiting: Waiting[];
  /** Null when no model is known: the first launch. */
  engine: EngineRow | null;
  /** « Ne pas déranger » until then (epoch ms); null when off. */
  quietUntil: number | null;
}

export interface TrayActions {
  open(): void;
  openConversation(conversationId: string): void;
  release(): void;
  /** « Ne pas déranger pendant 1 h », or its end when it is on. */
  quiet(): void;
  quit(): void;
}

/** At most this many conversations in the menu: the rest is in « À traiter ». */
const LISTED = 5;
const GiB = 1024 ** 3;

/** Failure first, then the person waited for, then a model asleep, else at rest. */
export function trayIcon(state: { failed: boolean; waiting: boolean; asleep: boolean }): TrayIcon {
  if (state.failed) return 'failure';
  if (state.waiting) return 'waiting';
  return state.asleep ? 'asleep' : 'rest';
}

export function trayMenu(words: MainWords, view: TrayView, actions: TrayActions, platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  const t = words.tray;
  // macOS draws a second line under the label; Windows and Linux do not: it follows the label.
  const lined = (label: string, sub: string | undefined): Pick<MenuItemConstructorOptions, 'label' | 'sublabel'> =>
    !sub ? { label } : platform === 'darwin' ? { label, sublabel: sub } : { label: `${label} — ${sub}` };
  const approvals = view.waiting.filter((one) => one.what === 'approval').length;
  const questions = view.waiting.length - approvals;
  const menu: MenuItemConstructorOptions[] = [
    { ...lined(t.tooltip, view.waiting.length > 0 ? t.waiting(approvals, questions) : t.nothingWaits), enabled: false },
    { type: 'separator' },
    { label: t.open, click: () => actions.open() },
    ...view.waiting.slice(0, LISTED).map(
      (one): MenuItemConstructorOptions => ({
        ...lined(one.title.trim() || t.untitled, one.what === 'approval' ? t.waitsApproval : t.waitsAnswer),
        click: () => actions.openConversation(one.conversationId),
      }),
    ),
    { type: 'separator' },
  ];
  if (view.engine) {
    const engine = view.engine;
    const vram =
      engine.vramBytes === null
        ? null
        : t.gib(new Intl.NumberFormat(words.locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(engine.vramBytes / GiB));
    const state =
      engine.status === 'ready' ? t.engineReady(vram) : engine.status === 'starting' ? t.engineStarting : engine.status === 'asleep' ? t.engineAsleep : t.engineStopped;
    menu.push(
      { ...lined(engine.name, state), enabled: false },
      { ...lined(t.release, t.releaseWhat), enabled: engine.status === 'ready', click: () => actions.release() },
    );
  }
  const time = view.quietUntil === null ? null : new Intl.DateTimeFormat(words.locale, { hour: '2-digit', minute: '2-digit' }).format(view.quietUntil);
  menu.push(
    { label: time ? t.quietUntil(time) : t.quiet, type: 'checkbox', checked: time !== null, click: () => actions.quiet() },
    { type: 'separator' },
    { ...lined(t.quit, t.quitWhat), click: () => actions.quit() },
  );
  return menu;
}
