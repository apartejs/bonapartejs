/**
 * The providers through the bridge (task 9.1): listed, an address probed, a service added — its key to the
 * system's vault through the core — or removed. A key goes in, never out.
 */

import { providersAdd, providersList, providersModels, providersProbe, providersRemove, providersSwitch } from '@aparte/bonaparte-shared';
import type { Core } from '@aparte/bonaparte-core';
import type { IpcRegistry } from './register.js';

export type ProvidersCore = { providers: Pick<Core['providers'], 'list' | 'probe' | 'add' | 'remove' | 'models'> } & Pick<Core, 'switchProvider'>;

export function registerProviderChannels(ipc: IpcRegistry, core: ProvidersCore): void {
  ipc.handle(providersList, () => core.providers.list());
  ipc.handle(providersProbe, ({ url, key }) => core.providers.probe(url, key));
  ipc.handle(providersAdd, ({ key, ...service }) => core.providers.add(service, key));
  ipc.handle(providersRemove, ({ id }) => core.providers.remove(id));
  ipc.handle(providersModels, ({ id }) => core.providers.models(id));
  ipc.handle(providersSwitch, ({ conversationId, id, model }) => core.switchProvider(conversationId, id, model));
}
