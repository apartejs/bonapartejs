/**
 * What the app does to be noticed when the window is not in front of the person (task 8.5): a banner by the
 * person's settings, the icon's colour and the taskbar's badge by what waits — never an approval given from there.
 */

import type { TurnEnd } from '@aparte/bonaparte-core';
import { describe, expect, it } from 'vitest';
import { createAttention, type AttentionView } from './attention.js';
import { mainWords } from './i18n/index.js';
import type { NotifyEvent, NotifySetting } from './notifications.js';
import type { EngineRow, Waiting } from './tray.js';

const HOUR = 3_600_000;

function setup(over: { settings?: Partial<Record<NotifyEvent, NotifySetting>>; focused?: boolean; shown?: string | null; engine?: EngineRow | null } = {}) {
  const state = {
    now: Date.parse('2026-11-16T21:47:00Z'),
    focused: over.focused ?? false,
    shown: over.shown === undefined ? null : over.shown,
    waiting: [] as Waiting[],
    unread: 0,
    failing: false,
    engine: over.engine === undefined ? ({ name: 'gemma', status: 'ready', vramBytes: null } as EngineRow) : over.engine,
  };
  const settings: Record<NotifyEvent, NotifySetting> = { replyDone: 'banner', approval: 'banner', question: 'badge', failure: 'banner', ...over.settings };
  const shown: { title: string; body: string; conversationId: string }[] = [];
  const views: AttentionView[] = [];
  const logged: string[] = [];
  const scheduled: { at: number; run: () => void }[] = [];
  const attention = createAttention({
    words: () => mainWords('fr'),
    setting: async (event) => settings[event],
    focused: () => state.focused,
    shown: () => state.shown,
    now: () => state.now,
    waiting: async () => {
      if (state.failing) throw new Error('The journal of c9 cannot be read at line 3');
      return { rows: state.waiting, unread: state.unread };
    },
    engine: async () => state.engine,
    show: (note) => shown.push(note),
    render: (view) => views.push(view),
    log: (message) => logged.push(message),
    later: (ms, run) => scheduled.push({ at: state.now + ms, run }),
  });
  return { attention, state, shown, views, logged, scheduled, last: () => views.at(-1)! };
}

const done: TurnEnd = { conversationId: 'c1', title: 'Exporter le récap en CSV', how: 'done', said: '3 fichiers changés.' };
const approval: TurnEnd = { conversationId: 'c2', title: 'Corriger les heures', how: 'approval', call: { name: 'edit_file', input: { path: 'src/format.ts' } } };

describe('being noticed', () => {
  it('a reply done while the person looks elsewhere: a banner that opens its conversation; the icon stays at rest', async () => {
    const { attention, shown, last } = setup();
    await attention.turnEnded(done);
    expect(shown).toEqual([{ title: 'Tour fini · Exporter le récap en CSV', body: '3 fichiers changés.', conversationId: 'c1' }]);
    expect(last()).toMatchObject({ icon: 'rest', badge: null });
  });

  it('nothing pops up for the conversation the person looks at, the window in front', async () => {
    const { attention, shown, state } = setup({ focused: true, shown: 'c1' });
    await attention.turnEnded(done);
    expect(shown).toEqual([]);
    state.shown = 'c2';
    await attention.turnEnded(approval);
    expect(shown).toEqual([]);
  });

  it('another conversation that ends or waits while the person looks at one: a banner, the window in front or not (audit C3)', async () => {
    const { attention, shown } = setup({ focused: true, shown: 'c9' });
    await attention.turnEnded(done);
    await attention.turnEnded(approval);
    expect(shown.map((note) => note.conversationId)).toEqual(['c1', 'c2']);
  });

  it('an approval waiting: a banner, the icon amber, the badge says it — until it is answered', async () => {
    const { attention, state, shown, last } = setup();
    state.waiting = [{ conversationId: 'c2', title: 'Corriger les heures', what: 'approval' }];
    await attention.turnEnded(approval);
    expect(shown.map((note) => note.title)).toEqual(['Attend ton accord · Corriger les heures']);
    expect(last()).toMatchObject({ icon: 'waiting', badge: { kind: 'waiting', text: 'bonaparte attend ton accord' } });
    expect(last().waiting).toEqual(state.waiting);
    // A reply not read waits too, but an approval says more.
    state.unread = 1;
    await attention.refresh();
    expect(last()).toMatchObject({ badge: { kind: 'waiting' } });
    state.unread = 0;
    state.waiting = [];
    await attention.refresh();
    expect(last()).toMatchObject({ icon: 'rest', badge: null });
  });

  it('a question, by default: no banner, the badge only', async () => {
    const { attention, state, shown, last } = setup();
    state.waiting = [{ conversationId: 'c3', title: 'Formulaire', what: 'question' }];
    await attention.turnEnded({ conversationId: 'c3', title: 'Formulaire', how: 'question', question: 'Une date vide ?' });
    expect(shown).toEqual([]);
    expect(last()).toMatchObject({ icon: 'waiting', badge: { kind: 'waiting', text: 'bonaparte attend ta réponse' } });
  });

  it('an event the person turned off: neither banner nor badge — the conversation is still listed in the menu', async () => {
    const { attention, state, shown, last } = setup({ settings: { approval: 'off' } });
    state.waiting = [{ conversationId: 'c2', title: 'Corriger les heures', what: 'approval' }];
    await attention.turnEnded(approval);
    expect(shown).toEqual([]);
    expect(last()).toMatchObject({ icon: 'rest', badge: null, waiting: state.waiting });
  });

  it('« Ne pas déranger pendant 1 h »: the badge, no banner — for an hour, or until chosen again', async () => {
    const { attention, state, shown, last } = setup();
    await attention.toggleQuiet();
    expect(last().quietUntil).toBe(state.now + HOUR);
    await attention.turnEnded(done);
    expect(shown).toEqual([]);
    state.now += HOUR;
    await attention.turnEnded(done);
    expect(shown).toHaveLength(1);
    expect(last().quietUntil).toBeNull();
    await attention.toggleQuiet();
    await attention.toggleQuiet();
    expect(last().quietUntil).toBeNull();
  });

  it('a failure: a banner, the icon red, until the person comes back to the window', async () => {
    const { attention, shown, last } = setup();
    await attention.turnEnded({ conversationId: 'c4', title: 'Compte', how: 'failed' });
    expect(shown.map((note) => note.title)).toEqual(['En panne · Compte']);
    expect(last()).toMatchObject({ icon: 'failure', badge: { kind: 'failure', text: 'bonaparte est en panne' } });
    await attention.focused();
    expect(last()).toMatchObject({ icon: 'rest', badge: null });
  });

  it('a reply done under « Pastille »: no banner, the badge says a reply is ready — until it is read; « Rien »: nothing', async () => {
    const { attention, state, shown, last } = setup({ settings: { replyDone: 'badge' } });
    state.unread = 1;
    await attention.turnEnded(done);
    expect(shown).toEqual([]);
    expect(last()).toMatchObject({ icon: 'rest', badge: { kind: 'done', text: 'bonaparte a fini une réponse' } });
    state.unread = 0;
    await attention.refresh();
    expect(last()).toMatchObject({ badge: null });
    const off = setup({ settings: { replyDone: 'off' } });
    off.state.unread = 2;
    await off.attention.turnEnded(done);
    expect(off.last()).toMatchObject({ badge: null });
  });

  it('« Ne pas déranger » ends by itself: when the hour is over, the menu says so', async () => {
    const { attention, state, scheduled, last } = setup();
    await attention.toggleQuiet();
    expect(last().quietUntil).toBe(state.now + HOUR);
    expect(scheduled.map((one) => one.at)).toEqual([state.now + HOUR]);
    state.now += HOUR;
    scheduled[0]!.run();
    await attention.refresh();
    expect(last().quietUntil).toBeNull();
  });

  it('a read that fails never stops the app: it is logged, the last drawing stays, and the next one is drawn', async () => {
    const { attention, state, logged, views } = setup();
    await attention.refresh();
    const before = views.length;
    state.failing = true;
    await expect(attention.refresh()).resolves.toBeUndefined();
    await expect(attention.turnEnded(done)).resolves.toBeUndefined();
    await expect(attention.focused()).resolves.toBeUndefined();
    await expect(attention.toggleQuiet()).resolves.toBeUndefined();
    expect(views).toHaveLength(before);
    expect(logged.some((line) => line.includes('cannot be read'))).toBe(true);
    state.failing = false;
    await attention.refresh();
    expect(views.length).toBeGreaterThan(before);
  });

  it('the model asleep: the icon grey; no model known: no engine in the menu', async () => {
    const asleep = setup({ engine: { name: 'gemma', status: 'asleep', vramBytes: null } });
    await asleep.attention.refresh();
    expect(asleep.last()).toMatchObject({ icon: 'asleep', engine: { status: 'asleep' } });
    const none = setup({ engine: null });
    await none.attention.refresh();
    expect(none.last()).toMatchObject({ icon: 'rest', engine: null });
  });
});
