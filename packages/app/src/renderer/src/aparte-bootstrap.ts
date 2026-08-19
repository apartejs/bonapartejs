import { registerDefaultRenderers } from '@aparte/core';

/**
 * Ce que la lib attend du renderer avant le premier rendu.
 *
 * `registerDefaultRenderers()` n'est appelé nulle part au chargement du
 * paquet : son unique appel vit dans le constructeur d'`AparteClient`
 * (`autoRegister: true`). Or bonaparte n'instancie JAMAIS `AparteClient` —
 * sa boucle d'outils ferait doublon avec la nôtre, qui tourne dans le main
 * process. Sans cet appel explicite, chaque segment tombe dans
 * « [Unknown segment type: … ] » : le texte du modèle n'apparaît pas.
 */
export function bootstrapAparte(): void {
  registerDefaultRenderers();
}
