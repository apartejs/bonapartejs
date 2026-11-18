/**
 * The built-in browser's pane through the bridge (task 10.1): its tabs, the address, back, reload, where the
 * tab shown is placed and at what size. The pages live in the main process: the window only says where.
 */

import { z } from 'zod';
import { defineChannel } from './contract.js';

const tabId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const browserTabSchema = z.object({
  tabId: z.string(),
  url: z.string(),
  title: z.string(),
  canGoBack: z.boolean(),
  loading: z.boolean(),
  error: z.string().optional(),
  errors: z.number(),
  warnings: z.number(),
});

export type BrowserTabView = z.infer<typeof browserTabSchema>;

export const browserConsoleLineSchema = z.object({ level: z.enum(['error', 'warning', 'info', 'debug']), text: z.string(), source: z.string() });

/** The tabs as they stand, and whether the agent reads the page shown now (« L'agent lit la page »). */
export const browserTabs = defineChannel('browser.tabs', z.void(), z.object({ tabs: z.array(browserTabSchema), reading: z.boolean() }));
export const browserOpenTab = defineChannel('browser.openTab', z.object({ tabId }), z.void());
export const browserCloseTab = defineChannel('browser.closeTab', z.object({ tabId }), z.void());
export const browserNavigate = defineChannel(
  'browser.navigate',
  z.object({ tabId, url: z.string().max(8192) }),
  z.union([z.object({ url: z.string(), title: z.string() }), z.object({ error: z.string() })]),
);
export const browserBack = defineChannel('browser.back', z.object({ tabId }), z.void());
export const browserReload = defineChannel('browser.reload', z.object({ tabId }), z.void());
const rect = z.object({ x: z.number(), y: z.number(), width: z.number().min(0), height: z.number().min(0) });
/** Where the tab shown goes, in the window's pixels; null: hidden (its pane closed or covered). */
export const browserPlace = defineChannel(
  'browser.place',
  z.object({ tabId, rect: rect.nullable(), device: z.enum(['desktop', 'phone']) }),
  z.void(),
);
/** Nothing of the browser on top: a page or a menu goes over its pane. */
export const browserHide = defineChannel('browser.hide', z.void(), z.void());
export const browserConsole = defineChannel('browser.console', z.object({ tabId }), z.array(browserConsoleLineSchema));

/** An element the person showed in the page (task 10.2). */
export const pickedElementSchema = z.object({
  selector: z.string(),
  path: z.string(),
  text: z.string(),
  width: z.number(),
  height: z.number(),
  fontSize: z.number(),
  bold: z.boolean(),
  color: z.string(),
  x: z.number(),
  y: z.number(),
});
export type PickedElement = z.infer<typeof pickedElementSchema>;

/** The accent the page outlines in: a colour, nothing else (it reaches the page's style). */
const accent = z.string().regex(/^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|color\(srgb[\d\s.%/]+\))$/);
/** « Sélectionner un élément » or « Commenter la page »: the element clicked, null when the person leaves. */
export const browserPick = defineChannel('browser.pick', z.object({ tabId, accent }), pickedElementSchema.nullable());
export const browserCancelPick = defineChannel('browser.cancelPick', z.object({ tabId }), z.void());
/** The comments' pins on the page, numbered; an empty list takes them off. */
export const browserPins = defineChannel(
  'browser.pins',
  z.object({ tabId, accent, ink: accent, pins: z.array(z.object({ n: z.number().int().min(1).max(999), x: z.number(), y: z.number() })).max(100) }),
  z.void(),
);
