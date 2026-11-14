/**
 * The entry of the built app, or an error that says what to do.
 *
 * Electron must never be launched on an app that is not built: it answers
 * with a native error box, on the person's screen, once per launch. So the
 * fixture asks this first, and nothing is launched when the answer is no.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function builtAppEntry(appRoot: string): string {
  const entry = join(appRoot, 'out', 'main', 'index.js');
  const page = join(appRoot, 'out', 'renderer', 'index.html');
  if (!existsSync(entry) || !existsSync(page)) {
    throw new Error(
      `The app is not built (${entry} or ${page} is missing). Run \`pnpm build\` first: Electron is never launched without it.`,
    );
  }
  return entry;
}
