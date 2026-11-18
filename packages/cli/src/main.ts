/**
 * What `bonaparte` does with its arguments: nothing launches the app (task 13.3); `doctor`, `--version`,
 * `--help`.
 * Everything it touches comes in by `CliDeps`, so it is tested without a terminal or a machine.
 */

import type { DoctorReport } from '@aparte/bonaparte-core';
import { formatDoctorReport } from './format.js';
import { en } from './messages/en.js';
import { fr } from './messages/fr.js';

export type CliLocale = 'fr' | 'en';

export interface CliDeps {
  stdout(text: string): void;
  stderr(text: string): void;
  locale: CliLocale;
  version: string;
  doctor(): Promise<DoctorReport>;
  /** No argument: the app, launched with a window of its own (task 13.3). Without it, the help. */
  launch?(): Promise<number>;
  /** The output is a terminal: the marks are coloured. */
  color?: boolean;
}

/** The language: BONAPARTE_LANG, then LC_ALL, then LANG, then the system's; French or English. */
export function localeOf(env: Record<string, string | undefined>, system = Intl.DateTimeFormat().resolvedOptions().locale): CliLocale {
  const said = env['BONAPARTE_LANG'] || env['LC_ALL'] || env['LANG'] || system;
  return said.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export async function main(args: readonly string[], deps: CliDeps): Promise<number> {
  const words = deps.locale === 'fr' ? fr : en;
  const command = args[0];
  if (command === '--version' || command === '-v') {
    deps.stdout(deps.version);
    return 0;
  }
  if (command === undefined && deps.launch) return deps.launch();
  if (command === undefined || command === '--help' || command === '-h') {
    deps.stdout(words.help(deps.version));
    return 0;
  }
  if (command === 'doctor') {
    const report = await deps.doctor();
    deps.stdout(formatDoctorReport(report, words, { color: deps.color ?? false }));
    return report.ok ? 0 : 1;
  }
  deps.stderr(words.unknownCommand(command));
  deps.stdout(words.help(deps.version));
  return 1;
}
