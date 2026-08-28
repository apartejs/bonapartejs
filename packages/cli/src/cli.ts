/**
 * bonaparte CLI — entry point for `npx @aparte/bonaparte`.
 * v1: `doctor` (checks machine dependencies) and launching the app.
 */

import {
  createSystemDoctorEnv,
  runDoctor,
} from '@aparte/bonaparte-core';
import type { BonaparteLocale } from '@aparte/bonaparte-shared';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDoctorReport } from './format.js';
import {
  electronBinary,
  electronNeedsDownload,
  electronPackageDir,
  launchApp,
  resolveAppDir,
} from './launch.js';
import { CLI_MESSAGES, helpText, unknownCommand } from './messages.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };
/** The CLI package root: this file is bundled into `dist/`. */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function detectLocale(): BonaparteLocale {
  const candidates = [
    process.env['BONAPARTE_LANG'],
    process.env['LC_ALL'],
    process.env['LANG'],
    Intl.DateTimeFormat().resolvedOptions().locale,
  ];
  for (const candidate of candidates) {
    if (candidate?.toLowerCase().startsWith('fr')) return 'fr';
    if (candidate?.toLowerCase().startsWith('en')) return 'en';
  }
  return 'en';
}

async function doctor(): Promise<number> {
  const locale = detectLocale();
  const report = await runDoctor(createSystemDoctorEnv(), locale);
  console.log(
    formatDoctorReport(report, locale, { color: process.stdout.isTTY ?? false }),
  );
  return report.ok ? 0 : 1;
}

async function launch(locale: BonaparteLocale): Promise<number> {
  const appDir = resolveAppDir(packageRoot, existsSync);
  if (!appDir) {
    console.error(CLI_MESSAGES[locale].appNotBuilt);
    return 1;
  }
  const electronDir = electronPackageDir();
  if (!electronDir) {
    console.error(CLI_MESSAGES[locale].electronMissing);
    return 1;
  }
  const readPathTxt = (path: string): string | null => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };
  if (electronNeedsDownload(electronDir, readPathTxt, existsSync)) {
    console.log(CLI_MESSAGES[locale].downloadingElectron);
  }
  const electron = electronBinary();
  if (!electron) {
    console.error(CLI_MESSAGES[locale].electronMissing);
    return 1;
  }
  return launchApp({ appDir, electron });
}

async function main(): Promise<number> {
  const arg = process.argv[2];
  const locale = detectLocale();

  switch (arg) {
    case '--version':
    case '-v':
      console.log(version);
      return 0;
    case '--help':
    case '-h':
      console.log(helpText(locale, version));
      return 0;
    case undefined:
      return launch(locale);
    case 'doctor':
      return doctor();
    default:
      console.error(`${unknownCommand(locale, arg)}\n`);
      console.log(helpText(locale, version));
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
