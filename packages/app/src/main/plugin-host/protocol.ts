/**
 * `bonaparte-plugin://<id>/` (task 11.2): where the view of a plugin of a third party is served, in a sandboxed
 * frame of the window. Its files only, from its own folder — a revision on trial under `@<rev>/` (task 11.4) —,
 * the kit's stylesheet and the app's tokens under `@bonaparte/kit.css`, and every answer with a strict policy: its
 * own scripts and styles, its own images and fonts, no connection anywhere, framed by the app's window only. The
 * frame has no bridge (the preload lives in the window's main frame alone) and cannot reach `bonaparte://app`.
 */

import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';

import { PLUGIN_SCHEME } from '@aparte/bonaparte-shared/agent';

export { PLUGIN_SCHEME };

export interface PluginFileDeps {
  /** The folder a plugin's view is served from: its own, or that of a revision on trial; null for none. */
  dirOf(id: string, rev?: string): string | null;
  /** The kit's stylesheet and the app's tokens, as one sheet. */
  kitCss: string;
}

export interface PluginFileAnswer {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const KIT = '@bonaparte/kit.css';

/** Its own scripts and styles, nothing that connects, framed by the app alone. */
function policyOf(base: string): string {
  return [
    "default-src 'none'",
    `script-src ${base}`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data:`,
    `font-src ${base} data:`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    'frame-ancestors bonaparte://app',
  ].join('; ');
}

export async function servePluginFile(url: string, deps: PluginFileDeps): Promise<PluginFileAnswer> {
  const notFound = (base: string): PluginFileAnswer => ({
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': policyOf(base) },
    body: new TextEncoder().encode('Not found.'),
  });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return notFound(`${PLUGIN_SCHEME}:`);
  }
  const id = parsed.hostname;
  // The raw path, decoded once: an encoded « .. » or backslash is still a step out.
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  } catch {
    return notFound(`${PLUGIN_SCHEME}://${id}`);
  }
  const trial = /^@(\d{1,6})\/(.*)$/.exec(path);
  const rev = trial?.[1];
  const file = trial ? trial[2]! : path;
  const base = rev ? `${PLUGIN_SCHEME}://${id}/@${rev}/` : `${PLUGIN_SCHEME}://${id}`;
  const headers = (type: string): Record<string, string> => ({
    'Content-Type': type,
    'Content-Security-Policy': policyOf(base),
    // A sandboxed frame is of no origin: its module scripts and styles are fetched across.
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
  });
  if (file === KIT) return { status: 200, headers: headers(TYPES['.css']!), body: new TextEncoder().encode(deps.kitCss) };
  if (!/^[a-z][a-z0-9-]*$/.test(id)) return notFound(base);
  const dir = deps.dirOf(id, rev);
  if (!dir) return notFound(base);
  const target = resolve(dir, file);
  const inside = relative(dir, target);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return notFound(base);
  const type = TYPES[extname(target).toLowerCase()];
  if (!type) return notFound(base);
  try {
    return { status: 200, headers: headers(type), body: await readFile(target) };
  } catch {
    return notFound(base);
  }
}
