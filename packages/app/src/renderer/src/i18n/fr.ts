import type { AppTranslations } from './types.js';

export const FR: AppTranslations = {
  app: {
    tagline: 'Coding agent local-first',
  },
  actions: {
    toggleTheme: 'Thème',
    toggleLocale: 'English',
  },
  setup: {
    eyebrow: 'premier lever de rideau',
    title: 'Brancher le moteur',
    intro:
      'bonaparte pilote un llama-server : lancez-en un ici même (managé) ou pointez vers un hôte existant. Le modèle se choisit ensuite, conversation par conversation.',
    modeRemote: 'Serveur distant',
    modeManaged: 'Managé (local)',
    url: 'URL du serveur',
    urlPlaceholder: 'http://127.0.0.1:8080',
    binPath: 'Binaire llama (ou llama-server)',
    binPathPlaceholder: 'C:\\outils\\llama\\llama.exe',
    browse: 'Parcourir…',
    detected: 'détecté sur cette machine',
    notInstalled:
      'llama.cpp ne semble pas installé sur cette machine. Installez-le puis revenez :',
    installWinget: 'Copier la commande winget',
    openReleases: 'Ouvrir les releases llama.cpp',
    start: 'Lever le rideau',
    starting: 'Démarrage…',
    failed: 'Échec du démarrage',
  },
  picker: {
    eyebrow: 'distribution',
    title: 'Choisir le modèle',
    intro:
      'Cette conversation sera jouée par ce modèle — il lui reste épinglé. Modèles trouvés sur cette machine :',
    scanning: 'Inventaire en cours…',
    empty:
      'Aucun modèle GGUF trouvé dans les emplacements connus. Ajoutez-en un avec Parcourir.',
    nCtx: 'Taille de contexte',
    manual: 'Parcourir…',
    confirm: 'Distribuer ce rôle',
  },
  chat: {
    placeholder: 'Écrivez à bonaparte…',
    errorPrefix: 'Erreur',
  },
  status: {
    stopped: 'arrêté',
    starting: 'démarrage…',
    ready: 'prêt',
    crashed: 'en panne',
    restarting: 'redémarrage…',
    restored: 'contexte restauré',
    notRestored: 'reprise à froid',
    reasons: {
      missing: 'aucun état sauvegardé',
      unsupported: 'backend sans persistance',
      model: 'modèle changé',
      nCtx: 'taille de contexte changée',
      cacheType: 'quantification KV changée',
      buildTag: 'build llama.cpp changé',
      corrupt: 'manifest corrompu',
    },
    prefill: 'prefill',
    cacheShare: 'cache',
    save: 'Sauvegarder l’état',
    saved: 'État sauvegardé',
    saveFailed: 'Sauvegarde impossible',
    changeBackend: 'Moteur…',
  },
};
