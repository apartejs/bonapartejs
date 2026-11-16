/**
 * What « À traiter » reads of a question a chat put on screen (aparté 1.12, `observeElicitations`): a question
 * that is one choice among options shows its choices as buttons; anything else opens its conversation.
 */

import type { AparteElicitationPending } from '@aparte/core';
import { describe, expect, it } from 'vitest';
import { choicesOf } from './questions';

const pending = (schema: unknown): AparteElicitationPending =>
  ({ request: { message: 'Une date vide : que fais-je ?', schema }, respond: () => undefined, settled: Promise.resolve() }) as unknown as AparteElicitationPending;

describe('the choices of a question', () => {
  it('one choice among options: each option, its words and the value that answers it', () => {
    expect(choicesOf(pending({ type: 'enum', options: [{ value: 'La garder vide', label: 'La garder vide' }, { value: 'refuse', title: 'La refuser' }] }))).toEqual([
      { label: 'La garder vide', value: 'La garder vide' },
      { label: 'La refuser', value: 'refuse' },
    ]);
  });

  it('several choices at once: none — one click would answer it with one value (check of aparté 1.12)', () => {
    expect(choicesOf(pending({ type: 'enum', multiple: true, options: [{ value: 'a' }, { value: 'b' }] }))).toBeNull();
  });

  it('free text, several questions, no options: none — the conversation answers it', () => {
    expect(choicesOf(pending({ type: 'string' }))).toBeNull();
    expect(choicesOf(pending({ type: 'object', properties: { q1: { type: 'string' } } }))).toBeNull();
    expect(choicesOf(pending({ type: 'enum', options: [] }))).toBeNull();
    expect(choicesOf(pending(undefined))).toBeNull();
  });
});
