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
}

export const CLI_MESSAGES: Record<BonaparteLocale, CliMessages> = {
  fr: {
    launch: "Lance l'application (bientôt)",
    doctor: 'Vérifie les dépendances machine',
    version: 'Affiche la version',
    help: 'Affiche cette aide',
    unknownCommand: 'Commande inconnue',
  },
  en: {
    launch: 'Launches the application (soon)',
    doctor: 'Check the machine dependencies',
    version: 'Show the version',
    help: 'Show this help',
    unknownCommand: 'Unknown command',
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
