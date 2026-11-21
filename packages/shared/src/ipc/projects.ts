/**
 * The projects, through the bridge (task 5.3): what a folder says before a
 * project is made of it, the projects, and a folder chosen by the person in
 * the system's own dialog. A folder is never something that runs: the core
 * reads it, and only ever works inside it.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';
import { playModeSchema } from './modes.js';

const idSchema = z.string().min(1).max(128);
const folderSchema = z.string().min(1).max(4096);

export const projectSchema = z.object({
  id: idSchema,
  name: z.string(),
  roots: z.array(z.string()),
  defaultMode: playModeSchema,
  /** What the project adds to the files always asked (« Dockerfile »). */
  alwaysAsk: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectView = z.infer<typeof projectSchema>;

export const projectFactsSchema = z.object({
  name: z.string(),
  git: z.union([z.object({ branch: z.string() }), z.object({ branch: z.null(), commit: z.string() }), z.null()]),
  packageManager: z.enum(['pnpm', 'yarn', 'bun', 'npm']).nullable(),
  scripts: z.array(z.string()),
  instructions: z.string().nullable(),
  services: z.array(z.string()),
});
export type ProjectFactsView = z.infer<typeof projectFactsSchema>;

export const projectsList = defineChannel('projects.list', z.void(), z.array(projectSchema));

/** What a folder says: read only — nothing written, nothing run. */
export const projectsDetect = defineChannel('projects.detect', z.object({ folder: folderSchema }), projectFactsSchema);

/** A folder the person chooses in the system's dialog; null when they close it. */
export const projectsChooseFolder = defineChannel('projects.chooseFolder', z.void(), z.object({ folder: folderSchema }).nullable());

export const projectsCreate = defineChannel(
  'projects.create',
  z.object({ name: z.string().trim().min(1).max(200), roots: z.array(folderSchema).min(1).max(16), defaultMode: playModeSchema }),
  projectSchema,
);

export const projectsUpdate = defineChannel(
  'projects.update',
  z.object({
    id: idSchema,
    changes: z.object({
      name: z.string().trim().min(1).max(200).optional(),
      roots: z.array(folderSchema).min(1).max(16).optional(),
      defaultMode: playModeSchema.optional(),
      alwaysAsk: z.array(z.string().trim().min(1).max(200)).max(64).optional(),
    }),
  }),
  projectSchema,
);

/**
 * Another conversation of the project works in its folder (audit C4): a reply running, a question or an approval
 * waiting, changes applied and not undone. A new one is then offered its own branch first.
 */
export const projectsFolderTaken = defineChannel(
  'projects.folderTaken',
  z.object({ id: idSchema }),
  z.object({ conversationId: z.string(), title: z.string() }).nullable(),
);

export const projectsRemove = defineChannel('projects.remove', z.object({ id: idSchema }), z.void());

/** « Ajouter un dossier » on the project's page: the folder chosen in the system's dialog; null when closed. */
export const projectsAddFolder = defineChannel('projects.addFolder', z.object({ id: idSchema }), projectSchema.nullable());

