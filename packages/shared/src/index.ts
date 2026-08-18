/**
 * @aparte/bonaparte-shared — types et schémas partagés entre le harness
 * (@aparte/bonaparte-core), l'app Electron et les plugins.
 *
 * Zéro dépendance workspace : ce paquet est une feuille du graphe.
 */

/** Locales supportées par bonaparte (UI et messages du harness). */
export type BonaparteLocale = 'fr' | 'en';

export const BONAPARTE_LOCALES: readonly BonaparteLocale[] = ['fr', 'en'];

/**
 * Canaux IPC main↔renderer. Un seul endroit fait autorité : le preload et le
 * main importent ces constantes, jamais de littéraux en double.
 */
export const IPC = {
  appVersion: 'app.version',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
