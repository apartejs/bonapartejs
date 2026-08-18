/**
 * CLI bonaparte — point d'entrée `npx @aparte/bonaparte`.
 * v1 : `doctor` (vérification des dépendances machine) et lancement de l'app.
 */

import {
  createSystemDoctorEnv,
  runDoctor,
} from '@aparte/bonaparte-core';
import type { BonaparteLocale } from '@aparte/bonaparte-shared';
import { createRequire } from 'node:module';
import { formatDoctorReport } from './format.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

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

const HELP = `('.') bonaparte v${version}

Usage:
  bonaparte            Lance l'application (bientôt)
  bonaparte doctor     Vérifie les dépendances machine
  bonaparte --version  Affiche la version
  bonaparte --help     Affiche cette aide
`;

async function main(): Promise<number> {
  const arg = process.argv[2];

  switch (arg) {
    case '--version':
    case '-v':
      console.log(version);
      return 0;
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      return 0;
    case 'doctor':
      return doctor();
    default:
      console.error(`Commande inconnue : ${arg}\n`);
      console.log(HELP);
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
