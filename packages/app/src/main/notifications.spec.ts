/**
 * What a turn's end tells the person when the window is not in front of them (task 8.5, board « Notifications et
 * zone de notification »): a banner, only a badge, or nothing — by the person's setting for that event, the
 * window's focus and « Ne pas déranger ». And what a banner says.
 */

import { describe, expect, it } from 'vitest';
import { mainWords } from './i18n/index.js';
import { decide, describeCall, EVENT_OF, notificationOf } from './notifications.js';

const NOW = Date.parse('2026-11-16T21:47:00Z');
const HOUR = 3_600_000;

describe('what an event becomes', () => {
  it.each([
    // setting, focused, quiet until, delivery
    ['banner', false, null, 'banner'],
    ['banner', true, null, 'badge'],
    ['banner', false, NOW + HOUR, 'badge'],
    ['banner', false, NOW - 1, 'banner'],
    ['badge', false, null, 'badge'],
    ['badge', true, null, 'badge'],
    ['off', false, null, 'none'],
    ['off', true, NOW + HOUR, 'none'],
  ] as const)('« %s », focused %s, quiet until %s: %s', (setting, focused, quietUntil, delivery) => {
    expect(decide({ setting, focused, quietUntil, now: NOW })).toBe(delivery);
  });

  it('each end of a turn is one of the four events the settings name', () => {
    expect(EVENT_OF).toEqual({ done: 'replyDone', approval: 'approval', question: 'question', failed: 'failure' });
  });
});

describe('what a banner says', () => {
  const words = mainWords('fr').notify;

  it('a turn done: the event and the conversation, then the first words of the answer', () => {
    expect(notificationOf({ conversationId: 'c1', title: 'Exporter le récap en CSV', how: 'done', said: '3 fichiers changés, les tests passent.' }, words)).toEqual({
      title: 'Tour fini · Exporter le récap en CSV',
      body: '3 fichiers changés, les tests passent.',
    });
  });

  it('an approval: what the call would do — never the means to give it', () => {
    const call = { name: 'edit_file', input: { path: 'src/format.ts', old_string: 'a', new_string: 'b' } };
    expect(notificationOf({ conversationId: 'c1', title: 'Corriger les heures décimales', how: 'approval', call }, words)).toEqual({
      title: 'Attend ton accord · Corriger les heures décimales',
      body: 'Modifier src/format.ts',
    });
    expect(notificationOf({ conversationId: 'c1', title: 'CI', how: 'approval', call: { name: 'run_command', input: { program: 'pnpm', args: ['test'] } }, agent: 'Mesureur' }, words).body).toBe(
      'Sous-agent Mesureur · Lancer pnpm test',
    );
  });

  it('a question: its words; a failure: that nothing is lost; an untitled conversation: its name in the app', () => {
    expect(notificationOf({ conversationId: 'c1', title: '', how: 'question', question: 'Une date vide : je la garde ?' }, words)).toEqual({
      title: 'Te pose une question · Nouvelle conversation',
      body: 'Une date vide : je la garde ?',
    });
    expect(notificationOf({ conversationId: 'c1', title: 'Compte', how: 'failed' }, words).body).toBe(
      'Le moteur s’est arrêté pendant la réponse. Rien n’est perdu : le journal est sauf.',
    );
  });

  it('a call is said in a few words, a long command cut', () => {
    const en = mainWords('en').notify;
    expect(describeCall({ name: 'write_file', input: { path: 'notes.md', content: 'x' } }, en)).toBe('Write notes.md');
    expect(describeCall({ name: 'web_fetch', input: { url: 'https://example.com/a' } }, en)).toBe('Read https://example.com/a');
    expect(describeCall({ name: 'plugin__x__y', input: {} }, en)).toBe('Use plugin__x__y');
    const long = describeCall({ name: 'run_command', input: { program: 'node', args: ['-e', 'x'.repeat(200)] } }, en);
    expect(long.length).toBeLessThanOrEqual(84);
    expect(long.endsWith('…')).toBe(true);
  });
});
