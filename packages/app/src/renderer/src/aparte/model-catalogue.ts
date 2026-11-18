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

/** A service added (task 9.3): its id, its name, the models it offers now. */
export interface ServiceCatalogue {
  id: string;
  label: string;
  models: readonly string[];
}

const servicesShown = new Set<string>();

/**
 * Lists each service's models in the picker beside the built-in engine's, one catalogue per service; a service
 * gone is taken out. The same list again tells aparté nothing (apartejs/aparte#251).
 */
export function showServices(services: readonly ServiceCatalogue[]): void {
  for (const id of [...servicesShown]) {
    if (services.some((service) => service.id === id)) continue;
    aparteGlobalConfig.unregisterAIProvider(id);
    servicesShown.delete(id);
  }
  for (const service of services) {
    const shown = JSON.stringify([service.label, service.models]);
    const registered = aparteGlobalConfig.getAIProvider(service.id);
    if (registered && shownList.get(registered) === shown) continue;
    if (registered) aparteGlobalConfig.unregisterAIProvider(service.id);
    const made = createModelCatalogue({
      id: service.id,
      name: service.label,
      isLocal: false,
      models: service.models.map((model) => ({ id: model, name: model })),
    });
    shownList.set(made, shown);
    aparteGlobalConfig.registerAIProvider(made);
    servicesShown.add(service.id);
  }
}
