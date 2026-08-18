/**
 * Version minimale de llama.cpp requise par bonaparte.
 *
 * bonaparte émet des options qui n'existent que sur des builds récents :
 * l'API de slots (--slot-save-path, POST /slots/{id}?action=…), --cache-reuse,
 * la forme `-fa on|off|auto`, --load-mode. Seuil conservateur : b6000 —
 * toutes ces options sont vérifiées présentes à cette époque (recherche du
 * 2026-08-18) ; ajustable si un test réel prouve qu'un build plus ancien passe.
 */

export const MIN_LLAMA_BUILD = 6000;

/**
 * Extrait le numéro de build depuis la sortie de `--version`, tous formats :
 * CLI unifié « b10217-ddd4ec142 », historique « version: 3952 (abc123) » ou
 * « llama-server b6521 ». null si introuvable.
 */
export function parseLlamaBuildNumber(versionOutput: string): number | null {
  // Forme préfixée « b10217 » (CLI unifié, tags de release, noms d'assets).
  const tagged = versionOutput.match(/\bb(\d{3,6})\b/);
  if (tagged?.[1]) return Number.parseInt(tagged[1], 10);
  // Forme historique « version: 3952 (hash) » / « build: 3952 ».
  const labeled = versionOutput.match(/\b(?:version|build)\s*[:=]?\s*(\d{3,6})\b/i);
  if (labeled?.[1]) return Number.parseInt(labeled[1], 10);
  return null;
}

export function isSupportedLlamaBuild(build: number): boolean {
  return build >= MIN_LLAMA_BUILD;
}
