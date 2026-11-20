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

/** A colour the window's buttons take: `#rrggbb` only — never a CSS expression from the page. */
const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * The colours of the window's own buttons, which the system draws over the app (`titleBarOverlay`): the page sends
 * its tokens as it resolves them, when the look changes.
 */
export const windowTitleBar = defineChannel('window.titleBar', z.object({ color: hexColour, symbolColor: hexColour }), z.void());
