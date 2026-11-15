/**
 * aparté's French says « vous »; bonaparte says « tu », and words of its own
 * where the boards have them (« Laisse-le choisir » for a question's skip).
 */

import { aparteGlobalConfig } from '@aparte/core';
import { fr as aparteFr } from '@aparte/locales/fr';
import { afterEach, describe, expect, it } from 'vitest';
import { fr } from '../i18n/fr';
import { speakAsBonaparte } from './words';

afterEach(() => aparteGlobalConfig.resetLocale());

describe('speakAsBonaparte', () => {
  it("says aparté's words the way bonaparte speaks, over aparté's French", () => {
    aparteGlobalConfig.setLocale(aparteFr);
    speakAsBonaparte(fr);
    expect(aparteGlobalConfig.t('elicitationSkip')).toBe('Laisse-le choisir');
    expect(aparteGlobalConfig.t('elicitationWaiting')).toBe('Attend ta réponse');
    expect(aparteGlobalConfig.t('conversationWaiting')).toBe('Attend ta réponse');
  });
});
