/**
 * The core sends its steps as keys (`slot-wait`, `restore`, `seed`,
 * `reread`): the page shows them in the language of the interface, through
 * aparté's step labels (apartejs/aparte#208, since 1.9).
 */

import { aparteGlobalConfig } from '@aparte/core';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { registerStepLabels } from './step-labels';

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
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
});
