/**
 * A message sent in the person's name (the review's comments, a plan's go-ahead, the fix of a CI): through the
 * composer, keeping what the person was writing. While the engine is unloaded the page holds every send
 * (`aparte-before-send`): such a message is then neither lost nor put in the person's place — it waits, and
 * goes once the engine is ready (check of aparté 1.12).
 */

import { describe, expect, it } from 'vitest';
import { attachToken, ENGINE_READY, sendAsPerson, sendWhenFree, speakingForThePerson, type Composer } from './composer';

/** A composer as aparté's behaves: a send empties it; a send the page holds leaves it as it was. */
function composer(initial: string) {
  const sent: string[] = [];
  const state = { held: false, speaking: [] as boolean[] };
  const field = {
    value: initial,
    streaming: false,
    panelActive: false,
    setValue(value: string) {
      field.value = value;
    },
    submit() {
      state.speaking.push(speakingForThePerson());
      if (state.held || field.value.trim() === '') return;
      sent.push(field.value);
      field.value = '';
    },
  };
  return { field: field as unknown as Composer, sent, state };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a message sent in the person’s name', () => {
  it('goes, and gives the person back what they were writing', () => {
    const { field, sent } = composer('mon brouillon');
    expect(sendAsPerson('Les commentaires', field)).toBe(true);
    expect(sent).toEqual(['Les commentaires']);
    expect(field.value).toBe('mon brouillon');
  });

  it('is said to be the person’s while it is sent, and only then', () => {
    const { field, state } = composer('');
    sendAsPerson('Lance le plan.', field);
    expect(state.speaking).toEqual([true]);
    expect(speakingForThePerson()).toBe(false);
  });

  it('held by the page (the engine unloaded): the draft stays, the message waits, and goes once the engine is ready', async () => {
    const page = new EventTarget();
    const { field, sent, state } = composer('mon brouillon');
    state.held = true;
    sendWhenFree('Les commentaires', () => field, page);
    expect(sent).toEqual([]);
    expect(field.value).toBe('mon brouillon');

    state.held = false;
    page.dispatchEvent(new Event(ENGINE_READY));
    await tick();
    expect(sent).toEqual(['Les commentaires']);
    expect(field.value).toBe('mon brouillon');
  });
});

describe('something of the page attached to the message (task 10.2)', () => {
  /** aparté's editor as it stands (1.14): a draft where each pill counts one character, its caret when it has one. */
  function withEditor(draft: string, caret: number | null) {
    const inserted: { from: number; to: number; token: unknown }[] = [];
    const input = {
      getCaret: () => (caret === null ? null : { text: draft, offset: caret }),
      insertToken: (from: number, to: number, token: unknown) => void inserted.push({ from, to, token }),
    };
    const field = { querySelector: (selector: string) => (selector === 'aparte-composer-input' ? input : null) } as unknown as Composer;
    return { field, inserted };
  }

  it('goes as a pill after what the person wrote — an offset past the end is its end (aparté 1.14) — the message saying it in full', () => {
    const { field, inserted } = withEditor('Regarde ça :', null);
    const token = { label: 'td.hours', text: 'This element: `td.hours`', kind: 'page-element' };
    expect(attachToken(token, field)).toBe(true);
    expect(inserted).toEqual([{ from: Number.POSITIVE_INFINITY, to: Number.POSITIVE_INFINITY, token }]);
  });

  it('goes at the caret when the person left one in the draft', () => {
    const { field, inserted } = withEditor('Regarde ça : et ça', 12);
    expect(attachToken({ label: 'x' }, field)).toBe(true);
    expect(inserted[0]).toMatchObject({ from: 12, to: 12 });
  });

  it('without a composer, nothing is attached', () => {
    expect(attachToken({ label: 'x' }, null)).toBe(false);
  });
});
