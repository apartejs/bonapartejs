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

/**
 * Each catalogue is registered under an id of its own (`bonaparte#3`): aparté's picker reads only the providers'
 * ids to know whether its list changed, and a catalogue replaced under the same id left it empty — the load that
 * the removal started won over the new one (apartejs/aparte#276) — or stale. The new one goes in before the old
 * one leaves, so a load in flight goes round again. `base` is the id the app knows (the engine's, a service's).
 */
const generations = new Map<string, number>();

/** The id `base`'s catalogue is registered under now. */
export function registeredId(base: string): string {
  const generation = generations.get(base);
  return generation === undefined ? base : `${base}#${generation}`;
}

/** The id the app knows, from the one a pick of the picker names. */
export function baseIdOf(id: string): string {
  return id.replace(/#\d+$/, '');
}

function replaceProvider(base: string, make: (id: string) => AparteAIProvider, shown: string): void {
  const before = aparteGlobalConfig.getAIProvider(registeredId(base)) ? registeredId(base) : null;
  const generation = (generations.get(base) ?? 0) + 1;
  generations.set(base, generation);
  const made = make(`${base}#${generation}`);
  shownList.set(made, shown);
  aparteGlobalConfig.registerAIProvider(made);
  if (before) aparteGlobalConfig.unregisterAIProvider(before);
}

function removeProvider(base: string): void {
  aparteGlobalConfig.unregisterAIProvider(registeredId(base));
  generations.delete(base);
}

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
  const registered = aparteGlobalConfig.getAIProvider(registeredId(ENGINE_PROVIDER));
  const listed = registered !== undefined && shownList.get(registered) === shown;
  const config = aparteGlobalConfig.getModelConfig();
  if (listed && config.defaultProvider === registeredId(ENGINE_PROVIDER) && config.defaultModel === current) return;
  if (!listed) replaceProvider(ENGINE_PROVIDER, (id) => createModelCatalogue({ id, name, isLocal: true, models }), shown);
  aparteGlobalConfig.setModelConfig({ defaultProvider: registeredId(ENGINE_PROVIDER), defaultModel: current });
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
    removeProvider(id);
    servicesShown.delete(id);
  }
  for (const service of services) {
    const shown = JSON.stringify([service.label, service.models]);
    const registered = aparteGlobalConfig.getAIProvider(registeredId(service.id));
    if (registered && shownList.get(registered) === shown) continue;
    const models = service.models.map((model) => ({ id: model, name: model }));
    replaceProvider(service.id, (id) => createModelCatalogue({ id, name: service.label, isLocal: false, models }), shown);
    servicesShown.add(service.id);
  }
}
