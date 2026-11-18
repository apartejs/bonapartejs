/**
 * « Mises à jour » (task 13.1, design §7.6): the app, llama.cpp and the
 * models, each with what it costs before it is done. Figures only: the window
 * says them.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

const progressSchema = z.object({ done: z.number(), total: z.number().nullable() });

export const appUpdateSchema = z.object({
  version: z.string(),
  /** What the release says it brings, as published; null when it says nothing. */
  notes: z.string().nullable(),
  bytes: z.number().nullable(),
  /** `ready`: downloaded, installed at the next restart. */
  state: z.enum(['available', 'downloading', 'ready']),
  progress: progressSchema.nullable(),
  /** A restart was asked while a reply runs: it waits for the end of the turn. */
  waiting: z.boolean(),
});
export type AppUpdateView = z.infer<typeof appUpdateSchema>;

export const modelUpdateSchema = z.object({
  id: z.string(),
  name: z.string(),
  file: z.string(),
  bytes: z.number(),
  replaces: z.string(),
  reread: z.object({ conversations: z.number(), tokens: z.number(), seconds: z.number() }),
  downloading: progressSchema.nullable(),
});
export type ModelUpdateView = z.infer<typeof modelUpdateSchema>;

export const updatesSchema = z.object({
  /** bonaparte's own version, and its update — null in a build that does not update itself. */
  current: z.string(),
  app: appUpdateSchema.nullable(),
  llama: z.object({ build: z.string(), bytes: z.number(), installing: progressSchema.nullable() }).nullable(),
  models: z.array(modelUpdateSchema),
  /** A reply runs: what installs waits for the end of the turn. */
  busy: z.boolean(),
});
export type UpdatesView = z.infer<typeof updatesSchema>;

/** What can be updated; `check` asks the releases again (never in a test run). */
export const updatesList = defineChannel('updates.list', z.object({ check: z.boolean() }), updatesSchema);
/** « Redémarrer »: once no reply runs, the app's update downloaded if it is not, then installed and the app restarted. */
export const updatesRestart = defineChannel('updates.restart', z.void(), z.void());
/** « Mettre à jour » llama.cpp: once no reply runs, the memory saved, the build installed, the model loaded again. */
export const updatesLlama = defineChannel('updates.llama', z.void(), z.void());
/** « Télécharger »: the new version of a model, its conversations moved onto it. */
export const updatesModel = defineChannel('updates.model', z.object({ id: z.string().min(1).max(128) }), z.void());
/** « Garder la version actuelle ». */
export const updatesKeep = defineChannel('updates.keep', z.object({ id: z.string().min(1).max(128) }), z.void());
