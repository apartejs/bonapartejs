/**
 * @aparte/bonaparte-core — le harness de bonaparte.
 *
 * Node pur : ce paquet n'importe JAMAIS electron (frontière garantie par la
 * règle lint @nx/enforce-module-boundaries). Il est consommé par le main
 * process de l'app Electron ET par le CLI `npx @aparte/bonaparte`.
 */

export type { HarnessTranslations } from './i18n/translations.js';
export { EN, FR, harnessT } from './i18n/translations.js';
