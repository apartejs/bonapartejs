/**
 * The CLI's own words: help and errors. User-facing, so localised like the
 * rest of the interface — one object per locale, the same keys in both.
 */

import type { BonaparteLocale } from '@aparte/bonaparte-shared';

interface CliMessages {
  launch: string;
  doctor: string;
  version: string;
  help: string;
  unknownCommand: string;
  appNotBuilt: string;
  electronMissing: string;
  downloadingElectron: string;
}

export const CLI_MESSAGES: Record<BonaparteLocale, CliMessages> = {
  fr: {
    launch: "Lance l'application",
    doctor: 'Vérifie les dépendances machine',
    version: 'Affiche la version',
    help: 'Affiche cette aide',
    unknownCommand: 'Commande inconnue',
    appNotBuilt:
      "Aucune application construite à côté de ce CLI (lancez `pnpm build` dans le dépôt, ou installez le paquet publié).",
    electronMissing:
      "Electron est introuvable : le paquet `electron` doit être installé à côté de ce CLI.",
    downloadingElectron:
      "Premier lancement : téléchargement d'Electron (environ 110 Mo, une seule fois)…",
  },
  en: {
    launch: 'Launches the application',
    doctor: 'Check the machine dependencies',
    version: 'Show the version',
    help: 'Show this help',
    unknownCommand: 'Unknown command',
    appNotBuilt:
      'No built application next to this CLI (run `pnpm build` in the repository, or install the published package).',
    electronMissing:
      'Electron was not found: the `electron` package must be installed next to this CLI.',
    downloadingElectron: 'First launch: downloading Electron (about 110 MB, once)…',
  },
};

export function helpText(locale: BonaparteLocale, version: string): string {
  const m = CLI_MESSAGES[locale];
  return `('.') bonaparte v${version}

Usage:
  bonaparte            ${m.launch}
  bonaparte doctor     ${m.doctor}
  bonaparte --version  ${m.version}
  bonaparte --help     ${m.help}
`;
}

export function unknownCommand(locale: BonaparteLocale, command: string): string {
  return `${CLI_MESSAGES[locale].unknownCommand}: ${command}`;
}
