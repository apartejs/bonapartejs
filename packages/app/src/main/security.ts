/**
 * Two questions the main process answers before it does anything for a page.
 * Both are pure functions, so that they can be tested without Electron.
 */

import { join, resolve, sep } from 'node:path';
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

/**
 * The file of the window that a path of `bonaparte://app/` names, or null when
 * the path would leave the window's folder.
 */
export function resolveAppFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = resolve(root);
  const target = resolve(base, `.${sep}${decoded}`);
  if (target === base) return join(base, 'index.html');
  return target.startsWith(base + sep) ? target : null;
}
