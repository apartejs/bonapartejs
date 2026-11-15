/**
 * The models the composer's picker lists (task 7.4). aparté's model selector
 * reads the providers of the page's config; a page whose turns run in the
 * core registers none (apartejs/aparte#244). So one descriptive provider
 * carries the core's models — their names, a line with their size and the
 * video memory they take — and is never asked to answer: every turn goes to
 * the core through the stream runner. The config's model is the one the
 * engine runs (or would load): what the picker shows.
 */

import { aparteGlobalConfig, type AparteAIModel, type AparteAIProvider } from '@aparte/core';
import type { ModelChoiceView } from '@aparte/bonaparte-shared';
import { formatBytes, type NumberStyle } from '../format';
import type { Messages } from '../i18n/index';

export const ENGINE_PROVIDER = 'bonaparte';

/** The models the built-in engine can load, as the picker lists them. */
export function catalogueOf(models: readonly ModelChoiceView[], messages: Messages, style: NumberStyle): AparteAIModel[] {
  return models
    .filter((model) => model.supported && model.announcement)
    .map((model) => ({
      id: model.path,
      name: model.name,
      description: messages.modelSwitch.line(formatBytes(model.sizeBytes, style), formatBytes(model.announcement!.vramBytes, style)),
    }));
}

function provider(models: AparteAIModel[], name: string): AparteAIProvider {
  return {
    id: ENGINE_PROVIDER,
    getMetadata: () => ({ id: ENGINE_PROVIDER, name, isLocal: true }),
    getModels: () => models,
    // Never asked: the stream runner sends every turn to the core.
    chat: () => Promise.reject(new Error('The core answers the turns of this page.')),
  };
}

/**
 * Lists `models` in the picker, `current` — the model that runs, or the one a load would bring back — shown
 * chosen. The provider is registered anew: the picker builds its list again only when the providers it was
 * built from change.
 */
export function showCatalogue(models: AparteAIModel[], name: string, current: string): void {
  aparteGlobalConfig.unregisterAIProvider(ENGINE_PROVIDER);
  aparteGlobalConfig.registerAIProvider(provider(models, name));
  aparteGlobalConfig.setModelConfig({ defaultProvider: ENGINE_PROVIDER, defaultModel: current });
}
