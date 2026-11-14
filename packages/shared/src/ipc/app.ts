import { z } from 'zod';
import { defineChannel } from './contract.js';

export const localeSchema = z.enum(['fr', 'en']);

/** The languages of the interface. Everything sent to a model stays English. */
export type Locale = z.infer<typeof localeSchema>;

/** What the window needs to know before it draws anything. */
export const appInfo = defineChannel(
  'app.info',
  z.void(),
  z.object({
    version: z.string(),
    locale: localeSchema,
  }),
);
