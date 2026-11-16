/**
 * The models the composer's picker lists (task 7.4): aparté's model catalogue (`createModelCatalogue`, aparté
 * 1.12, apartejs/aparte#244) carries the core's models — their names, a line with their size and the video
 * memory they take — and runs none: every turn goes to the core through the stream runner. The config's model
 * is the one the engine runs (or would load): what the picker shows.
 */

import { aparteGlobalConfig, createModelCatalogue, type AparteAIModel, type AparteAIProvider } from '@aparte/core';
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

/**
 * Lists `models` in the picker, `current` — the model that runs, or the one a load would bring back — shown
 * chosen. The catalogue is registered anew: the picker builds its list again only when the providers it was
 * built from change.
 */
export function showCatalogue(models: AparteAIModel[], name: string, current: string): void {
  // The same list again tells aparté nothing: a change of its config is work for every element that follows it
  // (it closed an open row menu until aparté 1.12, apartejs/aparte#251).
  const shown = JSON.stringify([models, name]);
  const registered = aparteGlobalConfig.getAIProvider(ENGINE_PROVIDER);
  if (registered && shownList.get(registered) === shown && aparteGlobalConfig.getModelConfig().defaultModel === current) return;
  aparteGlobalConfig.unregisterAIProvider(ENGINE_PROVIDER);
  const made = createModelCatalogue({ id: ENGINE_PROVIDER, name, isLocal: true, models });
  shownList.set(made, shown);
  aparteGlobalConfig.registerAIProvider(made);
  aparteGlobalConfig.setModelConfig({ defaultProvider: ENGINE_PROVIDER, defaultModel: current });
}

/** What each catalogue registered here lists: one taken down elsewhere is listed again. */
const shownList = new WeakMap<AparteAIProvider, string>();
