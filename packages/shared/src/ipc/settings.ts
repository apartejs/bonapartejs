/**
 * The app's settings through the bridge (task 5.9; the settings pages of 5.7
 * write them), and the export of the conversations: the window says the
 * words of the file — who is the person, who answered — and never where it
 * goes: the main process asks the person in the system's dialog.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

/** Every app setting, as the person left it or its default: what the settings pages show. */
export const settingsAll = defineChannel('settings.all', z.void(), z.array(z.object({ key: z.string(), value: z.unknown() })));

/** A setting changed: checked by the core (its key, its type, its options) before it is kept. */
export const settingsSet = defineChannel('settings.set', z.object({ key: z.string().min(1).max(64), value: z.unknown() }), z.void());

/** « Ouvrir le dossier »: the data folder, whose path only the main process knows. */
export const appOpenDataFolder = defineChannel('app.openDataFolder', z.void(), z.void());

/** A setting as the person left it, or its default. An unknown key is refused by the core. */
export const settingsGet = defineChannel('settings.get', z.object({ key: z.string().min(1).max(64) }), z.unknown());

const label = z.string().min(1).max(64);

export const conversationsExport = defineChannel(
  'conversations.export',
  // Strict: a folder sent by the window is refused, not ignored.
  z.strictObject({ labels: z.strictObject({ person: label, assistant: label, untitled: label }) }),
  // null: the person closed the dialog, and nothing was written.
  z.object({ folder: z.string(), count: z.number().int().nonnegative() }).nullable(),
);
