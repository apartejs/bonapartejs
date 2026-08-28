import type { HarnessTranslations } from './types.js';

export const FR: HarnessTranslations = {
  doctor: {
    title: 'Diagnostic bonaparte',
    checkNode: 'Version de Node.js',
    checkLlamaServer: 'Binaire llama-server',
    checkSlotSavePath: 'Répertoire des états KV (écriture)',
    checkGpu: 'Détection GPU',
    ok: 'OK',
    fail: 'ÉCHEC',
    warn: 'ATTENTION',
    allGood: 'Tout est en ordre.',
    hasBlockingIssues: 'Des problèmes bloquants ont été détectés.',
    lowDisk: 'Espace disque faible',
    cpuOnly: 'Aucun GPU détecté — exécution CPU uniquement',
    versionUnknown: 'version indéterminable, compatibilité slots non garantie',
    nodeRequired: 'Node ≥ {min} requis',
    gib: 'Gio',
  },
  backend: {
    starting: 'Démarrage du serveur de modèle…',
    ready: 'Serveur de modèle prêt.',
    stopped: 'Serveur de modèle arrêté.',
    crashed: 'Le serveur de modèle s’est arrêté de façon inattendue.',
    restarting: 'Redémarrage du serveur de modèle…',
    downloading: 'Téléchargement de llama-server…',
  },
  kv: {
    saved: 'Contexte de la conversation sauvegardé.',
    restored: 'Contexte de la conversation restauré.',
    restoreRefusedMismatch:
      'Restauration refusée : la configuration du modèle a changé depuis la sauvegarde.',
    reprefillNeeded:
      'Le contexte doit être recalculé entièrement (re-prefill).',
  },
  dialogs: {
    ggufModel: 'Modèle GGUF',
    executable: 'Exécutable',
    allFiles: 'Tous les fichiers',
  },
  errors: {
    llamaServerNotFound:
      'llama-server introuvable — ni configuré, ni présent sur le PATH.',
    llamaTooOld:
      'build llama.cpp trop ancien pour la persistance de contexte (slots) — mettez à jour.',
    slotSavePathNotWritable:
      'Le répertoire des états KV n’est pas accessible en écriture.',
    modelFileNotFound: 'Fichier de modèle introuvable.',
    backendUnreachable: 'Le serveur de modèle ne répond pas.',
  },
};
