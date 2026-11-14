/**
 * The questions the main process answers before it does anything for a page.
 * All are pure functions, so that they can be tested without Electron.
 */

import * as nodePath from 'node:path';
import { APP_ORIGIN } from '@aparte/bonaparte-shared';

function originOf(url: string): string | undefined {
  try {
    const { protocol, host } = new URL(url);
    return host ? `${protocol}//${host}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Is this URL one of our pages? The pages of the app, and in development the
 * dev server that serves them. Nothing else may use the IPC bridge.
 */
export function isTrustedOrigin(url: string, devServerUrl?: string): boolean {
  const origin = originOf(url);
  if (origin === undefined) return false;
  if (origin === APP_ORIGIN) return true;
  return devServerUrl !== undefined && origin === originOf(devServerUrl);
}

/** A URL without its fragment, or undefined when it is not one. */
function pageOf(url: string): string | undefined {
  try {
    const { protocol, host, pathname, search } = new URL(url);
    return `${protocol}//${host}${pathname}${search}`;
  } catch {
    return undefined;
  }
}

/**
 * Is this URL the page the window lives on? The window is one page. Going to
 * any other address — of the app or not — would replace the conversation: a
 * reply may hold a link to `package.json`, and a click on it must not.
 */
export function isOwnPage(url: string, ownPage: string): boolean {
  const page = pageOf(url);
  return page !== undefined && page === pageOf(ownPage);
}

const THIS_MACHINE = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The dev server that serves the window, or nothing. electron-vite names it in
 * `ELECTRON_RENDERER_URL` while developing. A packaged app never reads that
 * variable — whoever sets it would choose the page that gets the bridge — and
 * a dev server is on this machine.
 */
export function devServerUrlFrom(env: Record<string, string | undefined>, isPackaged: boolean): string | undefined {
  if (isPackaged) return undefined;
  const url = env['ELECTRON_RENDERER_URL'];
  if (!url) return undefined;
  try {
    const { protocol, hostname } = new URL(url);
    const web = protocol === 'http:' || protocol === 'https:';
    return web && THIS_MACHINE.has(hostname) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The part of `node:path` used here: its Windows or its POSIX flavour can be handed in. */
export type PathFlavour = Pick<nodePath.PlatformPath, 'join' | 'resolve' | 'sep'>;

/**
 * The file of the window that a path of `bonaparte://app/` names, or null when
 * the path would leave the window's folder.
 */
export function resolveAppFile(root: string, pathname: string, paths: PathFlavour = nodePath): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // No path of the app holds a NUL or a backslash. A backslash is a separator
  // on Windows and a character of a file name elsewhere: refusing it everywhere
  // gives the same answer on every system.
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const base = paths.resolve(root);
  const target = paths.resolve(base, `.${paths.sep}${decoded}`);
  if (target === base) return paths.join(base, 'index.html');
  return target.startsWith(base + paths.sep) ? target : null;
}
