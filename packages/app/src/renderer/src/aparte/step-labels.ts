/**
 * The core's steps keep their keys in the stream (`slot-wait`, `restore`,
 * `seed`, `reread`); the page shows them in the language of the interface —
 * beside the waiting dots, and to a screen reader — through aparté's step
 * labels (apartejs/aparte#208, since 1.9).
 */

import { aparteGlobalConfig } from '@aparte/core';
import type { Messages } from '../i18n/index';

/** Labels every step of the core; the function returned takes them back. */
export function registerStepLabels(messages: Messages): () => void {
  const releases = Object.entries(messages.steps).map(([key, label]) => aparteGlobalConfig.registerStepLabel(key, label));
  return () => {
    for (const release of releases) release();
  };
}
