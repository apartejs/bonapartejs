/**
 * Where models are looked for (Settings, Models — task 5.7): a folder added,
 * chosen in the system's dialog — never named by the window —, and the
 * search of the whole disk, started, followed and cancelled.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

/** « Ajouter un dossier »: the folders searched after it; null when the person closed the dialog. */
export const modelsAddFolder = defineChannel('models.addFolder', z.void(), z.array(z.string()).nullable());

export const diskScanStateSchema = z.object({
  running: z.boolean(),
  done: z.boolean(),
  cancelled: z.boolean(),
  visited: z.number().int().nonnegative(),
  folders: z.array(z.string()),
});
export type DiskScanStateView = z.infer<typeof diskScanStateSchema>;

export const modelsScanDisk = defineChannel('models.scanDisk', z.void(), diskScanStateSchema);
export const modelsScanState = defineChannel('models.scanState', z.void(), diskScanStateSchema);
export const modelsScanCancel = defineChannel('models.scanCancel', z.void(), diskScanStateSchema);
