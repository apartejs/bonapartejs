/**
 * The providers through the bridge (task 9.1): the built-in engine and the services the person adds. The window
 * hands a key over once, when a service is added or tested; it is never given one back — only whether there is
 * one.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

const serverSchema = z.enum(['llamacpp', 'ollama', 'lmstudio', 'openai']);

export const providerViewSchema = z.object({
  id: z.string(),
  kind: z.enum(['builtin', 'llamacpp-remote', 'openai-compat']),
  label: z.string(),
  url: z.string().optional(),
  server: serverSchema.optional(),
  hasKvMemory: z.boolean(),
  hasKey: z.boolean(),
});
export type ProviderViewData = z.infer<typeof providerViewSchema>;

export const probeResultSchema = z.union([
  z.object({ kind: z.literal('llamacpp-remote'), url: z.string(), models: z.array(z.string()), totalSlots: z.number().optional() }),
  z.object({ kind: z.literal('openai-compat'), url: z.string(), models: z.array(z.string()) }),
  z.object({
    error: z.enum(['invalid-address', 'unreachable', 'timeout', 'refused-key', 'not-a-service']),
    message: z.string(),
  }),
]);
export type ProbeResultView = z.infer<typeof probeResultSchema>;

const key = z.string().min(1).max(4096);

export const providersList = defineChannel('providers.list', z.void(), z.array(providerViewSchema));

/** « Tester la connexion »: what answers at an address, the key typed if any. */
export const providersProbe = defineChannel('providers.probe', z.object({ url: z.string().max(2048), key: key.optional() }), probeResultSchema);

/** « Se connecter »: a service added, its key to the system's vault. */
export const providersAdd = defineChannel(
  'providers.add',
  z.object({
    kind: z.enum(['llamacpp-remote', 'openai-compat']),
    label: z.string().min(1).max(200),
    url: z.url().max(2048),
    server: serverSchema.optional(),
    key: key.optional(),
  }),
  providerViewSchema,
);

export const providersRemove = defineChannel('providers.remove', z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) }), z.void());

/** The models a service offers now (the composer's picker); empty when it does not answer. */
export const providersModels = defineChannel('providers.models', z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) }), z.array(z.string()));

/** A conversation goes to a service between two turns (task 9.3), what it loses said first. */
export const providersSwitch = defineChannel(
  'providers.switch',
  z.object({ conversationId: z.string().min(1).max(128), id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), model: z.string().min(1).max(512) }),
  z.void(),
);
