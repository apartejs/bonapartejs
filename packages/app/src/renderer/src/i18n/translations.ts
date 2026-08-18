/**
 * i18n de l'UI (renderer) — même pattern TS-typé que le harness : une
 * interface, une constante par locale. Les chaînes du harness (doctor,
 * erreurs backend) vivent dans @aparte/bonaparte-core, pas ici.
 */

import type { BonaparteLocale } from '@aparte/bonaparte-shared';

export interface AppTranslations {
  app: {
    tagline: string;
    scaffoldNote: string;
  };
  actions: {
    toggleTheme: string;
    toggleLocale: string;
  };
}

export const FR: AppTranslations = {
  app: {
    tagline: 'Coding agent local-first',
    scaffoldNote: 'Fondations en cours de construction — Jalon 1.',
  },
  actions: {
    toggleTheme: 'Basculer le thème',
    toggleLocale: 'English',
  },
};

export const EN: AppTranslations = {
  app: {
    tagline: 'Local-first coding agent',
    scaffoldNote: 'Foundations under construction — Milestone 1.',
  },
  actions: {
    toggleTheme: 'Toggle theme',
    toggleLocale: 'Français',
  },
};

export const APP_LOCALES: Record<BonaparteLocale, AppTranslations> = {
  fr: FR,
  en: EN,
};
