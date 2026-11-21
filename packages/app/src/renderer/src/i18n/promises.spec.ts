/**
 * What a setting's words promise is what the app does. A hint that says a banner never comes while bonaparte is in
 * front, or that a sub-agent on a service leaves the built-in engine free, is read as a promise.
 */

import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { fr } from './fr.js';

describe('the settings say what the app does', () => {
  it('a banner comes for a conversation not shown, the window in front too (review of C3)', () => {
    expect(fr.settings.general.notificationsHint).toMatch(/une autre conversation/);
    expect(en.settings.general.notificationsHint).toMatch(/another conversation/);
  });

  it('a sub-agent on a service takes no slot, but its conversation keeps its own while it works (review of S1)', () => {
    expect(fr.settings.general.subagentsEngineHint).toMatch(/sa conversation garde le sien tant qu’il travaille/);
    expect(en.settings.general.subagentsEngineHint).toMatch(/its conversation keeps its own while it works/);
  });
});
