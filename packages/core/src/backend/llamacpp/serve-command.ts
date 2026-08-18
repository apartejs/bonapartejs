/**
 * llama.cpp existe sous deux formes : le binaire historique `llama-server`
 * (les flags directement) et le CLI unifié `llama` (b10xxx+, sous-commande
 * `serve` devant les mêmes flags). Déduit le préfixe d'arguments du nom du
 * binaire.
 */

export function detectServeCommandPrefix(binPath: string): string[] {
  const base = binPath.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const name = base.endsWith('.exe') ? base.slice(0, -4) : base;
  return name === 'llama' ? ['serve'] : [];
}
