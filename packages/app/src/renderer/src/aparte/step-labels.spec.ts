/**
 * The core sends its steps as keys (`slot-wait`, `restore`, `seed`,
 * `reread`): the page shows them in the language of the interface, through
 * aparté's step labels (apartejs/aparte#208, since 1.9).
 */

import { aparteGlobalConfig } from '@aparte/core';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { endWaits, forgetWaits, hearWait, waitsForEngine } from './engine-wait';
import { registerStepLabels } from './step-labels';

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
  forgetWaits();
});

describe('registerStepLabels', () => {
  it("labels every step of the core in the interface's language", () => {
    release = registerStepLabels(fr);
    expect(aparteGlobalConfig.getStepLabel('reread')).toBe(fr.steps.reread);
    expect(aparteGlobalConfig.getStepLabel('slot-wait')).toBe(fr.steps['slot-wait']);
    expect(aparteGlobalConfig.getStepLabel('restore')).toBe(fr.steps.restore);
    expect(aparteGlobalConfig.getStepLabel('seed')).toBe(fr.steps.seed);
  });

  it('takes its labels back when asked', () => {
    registerStepLabels(en)();
    expect(aparteGlobalConfig.getStepLabel('reread')).toBeUndefined();
  });

  it('a wait for the engine names who holds it and what it does, as the core said it (audit C1)', () => {
    release = registerStepLabels(fr);
    const holder = { conversationId: 'a', title: 'Refonte du login', doing: { kind: 'tool', tool: 'run_command', target: 'pnpm test' } };
    hearWait('b', { type: 'step-start', name: 'slot-wait', holder });
    expect(aparteGlobalConfig.getStepLabel('slot-wait')).toBe('Attend le moteur : « Refonte du login » lance pnpm test');
    expect(waitsForEngine('b')).toBe(true);
    // Said again: it answers now.
    hearWait('b', { type: 'step-end', name: 'slot-wait' });
    hearWait('b', { type: 'step-start', name: 'slot-wait', holder: { ...holder, doing: { kind: 'answer' } } });
    expect(aparteGlobalConfig.getStepLabel('slot-wait')).toBe('Attend le moteur : « Refonte du login » répond');
    // A sub-agent, and an untitled conversation.
    hearWait('c', { type: 'step-start', name: 'slot-wait', agentId: 'x', holder: { conversationId: 'a', title: '', subagent: 'Lecteur', doing: { kind: 'tool', tool: 'read_file', target: 'a.ts' } } });
    expect(aparteGlobalConfig.getStepLabel('slot-wait')).toBe('Attend le moteur : le sous-agent Lecteur de « Nouvelle conversation » lit a.ts');
    expect(waitsForEngine('c')).toBe(false);
    endWaits('c');
    endWaits('b');
    expect(waitsForEngine('b')).toBe(false);
    // No holder said: the plain words.
    expect(aparteGlobalConfig.getStepLabel('slot-wait')).toBe(fr.steps['slot-wait']);
  });
});
