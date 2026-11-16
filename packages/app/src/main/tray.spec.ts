/**
 * The notification area's menu (task 5.9, completed by 8.5; board « Notifications et zone de notification »): the
 * app and what waits, « Ouvrir bonaparte », each conversation that waits for the person, the engine and its video
 * memory, « Libérer le modèle », « Ne pas déranger pendant 1 h », « Quitter ». On Windows an item's second line
 * follows its label; macOS draws it under.
 */

import { describe, expect, it } from 'vitest';
import { mainWords } from './i18n/index.js';
import { trayIcon, trayMenu, type TrayActions, type TrayView } from './tray.js';

const GiB = 1024 ** 3;

function actions(done: string[]): TrayActions {
  return {
    open: () => done.push('open'),
    openConversation: (id) => done.push(`conversation ${id}`),
    release: () => done.push('release'),
    quiet: () => done.push('quiet'),
    quit: () => done.push('quit'),
  };
}

const VIEW: TrayView = {
  waiting: [{ conversationId: 'c1', title: 'Corriger les heures décimales', what: 'approval' }],
  engine: { name: 'Qwen3.6-35B-A3B', status: 'ready', vramBytes: 23.1 * GiB },
  quietUntil: null,
};

describe('the tray menu', () => {
  it('as the board draws it, on Windows: each second line after its label', () => {
    const menu = trayMenu(mainWords('fr'), VIEW, actions([]), 'win32');
    expect(menu.map((item) => (item.type === 'separator' ? '—' : item.label))).toEqual([
      'bonaparte — 1 accord attendu',
      '—',
      'Ouvrir bonaparte',
      'Corriger les heures décimales — attend ton accord',
      '—',
      'Qwen3.6-35B-A3B — prêt · 23,1 Go de mémoire vidéo',
      'Libérer le modèle — la mémoire des conversations reste sur disque',
      'Ne pas déranger pendant 1 h',
      '—',
      'Quitter — arrête le moteur, rien ne se perd',
    ]);
    // What only says: the app's line and the engine's.
    expect(menu.filter((item) => item.enabled === false).map((item) => item.label)).toEqual([
      'bonaparte — 1 accord attendu',
      'Qwen3.6-35B-A3B — prêt · 23,1 Go de mémoire vidéo',
    ]);
  });

  it('on macOS, the second line under the label', () => {
    const menu = trayMenu(mainWords('en'), VIEW, actions([]), 'darwin');
    expect(menu.find((item) => item.label === 'Quit')?.sublabel).toBe('stops the engine, nothing is lost');
    expect(menu.find((item) => item.label === 'Corriger les heures décimales')?.sublabel).toBe('waits for your approval');
  });

  it('each item does what it says: a conversation that waits opens on it — it is never answered from here', () => {
    const done: string[] = [];
    const menu = trayMenu(mainWords('fr'), VIEW, actions(done), 'win32');
    for (const item of menu.filter((one) => one.type !== 'separator' && one.enabled !== false)) item.click?.(undefined as never, undefined, undefined as never);
    expect(done).toEqual(['open', 'conversation c1', 'release', 'quiet', 'quit']);
  });

  it('a question waits for an answer; nothing waits; an engine asleep has nothing to release', () => {
    const fr = mainWords('fr');
    const question = trayMenu(fr, { ...VIEW, waiting: [{ conversationId: 'c2', title: '', what: 'question' }] }, actions([]), 'win32');
    expect(question[0]?.label).toBe('bonaparte — 1 question');
    expect(question.map((item) => item.label)).toContain('Nouvelle conversation — attend ta réponse');
    const asleep = trayMenu(fr, { waiting: [], engine: { name: 'gemma', status: 'asleep', vramBytes: null }, quietUntil: null }, actions([]), 'win32');
    expect(asleep[0]?.label).toBe('bonaparte — rien ne t’attend');
    expect(asleep.find((item) => item.label?.startsWith('Libérer'))?.enabled).toBe(false);
    expect(asleep.map((item) => item.label)).toContain('gemma — endormi · la mémoire des conversations est sur disque');
    // No model known: no engine line, nothing to release.
    const none = trayMenu(fr, { waiting: [], engine: null, quietUntil: null }, actions([]), 'win32');
    expect(none.some((item) => item.label?.startsWith('Libérer'))).toBe(false);
  });

  it('« Ne pas déranger » on: until when, checked; chosen again, it ends', () => {
    const until = new Date(2026, 10, 16, 22, 47).getTime();
    const menu = trayMenu(mainWords('fr'), { ...VIEW, quietUntil: until }, actions([]), 'win32');
    const quiet = menu.find((item) => item.label?.startsWith('Ne pas déranger'));
    expect(quiet).toMatchObject({ label: 'Ne pas déranger · jusqu’à 22:47', type: 'checkbox', checked: true });
  });

  it('the icon: failure first, then the person waited for, then a model asleep, else at rest', () => {
    expect(trayIcon({ failed: true, waiting: true, asleep: true })).toBe('failure');
    expect(trayIcon({ failed: false, waiting: true, asleep: true })).toBe('waiting');
    expect(trayIcon({ failed: false, waiting: false, asleep: true })).toBe('asleep');
    expect(trayIcon({ failed: false, waiting: false, asleep: false })).toBe('rest');
  });
});
