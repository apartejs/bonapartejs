/**
 * i18n de l'UI (renderer) — même pattern TS-typé que le harness : une
 * interface, une constante par locale. Les chaînes du harness (doctor,
 * erreurs backend) vivent dans @aparte/bonaparte-core, pas ici.
 */

import type { BonaparteLocale } from '@aparte/bonaparte-shared';

export interface AppTranslations {
  app: {
    tagline: string;
  };
  actions: {
    toggleTheme: string;
    toggleLocale: string;
  };
  setup: {
    eyebrow: string;
    title: string;
    intro: string;
    modeRemote: string;
    modeManaged: string;
    url: string;
    urlPlaceholder: string;
    binPath: string;
    binPathPlaceholder: string;
    modelPath: string;
    modelPathPlaceholder: string;
    nCtx: string;
    start: string;
    starting: string;
    failed: string;
  };
  chat: {
    placeholder: string;
    errorPrefix: string;
  };
  status: {
    stopped: string;
    starting: string;
    ready: string;
    crashed: string;
    restarting: string;
    restored: string;
    notRestored: string;
    reasons: Record<string, string>;
    prefill: string;
    cacheShare: string;
    save: string;
    saved: string;
    saveFailed: string;
    changeBackend: string;
  };
}

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
    title: 'Brancher un modèle',
    intro:
      'bonaparte pilote un llama-server : lancez-en un ici même (managé) ou pointez vers un hôte existant.',
    modeRemote: 'Serveur distant',
    modeManaged: 'Managé (local)',
    url: 'URL du serveur',
    urlPlaceholder: 'http://127.0.0.1:8080',
    binPath: 'Binaire llama-server',
    binPathPlaceholder: 'C:\\outils\\llama\\llama-server.exe',
    modelPath: 'Modèle GGUF',
    modelPathPlaceholder: 'D:\\models\\qwen3.gguf',
    nCtx: 'Taille de contexte',
    start: 'Lever le rideau',
    starting: 'Démarrage…',
    failed: 'Échec du démarrage',
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
    changeBackend: 'Backend…',
  },
};

export const EN: AppTranslations = {
  app: {
    tagline: 'Local-first coding agent',
  },
  actions: {
    toggleTheme: 'Theme',
    toggleLocale: 'Français',
  },
  setup: {
    eyebrow: 'curtain up',
    title: 'Connect a model',
    intro:
      'bonaparte drives a llama-server: launch one right here (managed) or point to an existing host.',
    modeRemote: 'Remote server',
    modeManaged: 'Managed (local)',
    url: 'Server URL',
    urlPlaceholder: 'http://127.0.0.1:8080',
    binPath: 'llama-server binary',
    binPathPlaceholder: 'C:\\tools\\llama\\llama-server.exe',
    modelPath: 'GGUF model',
    modelPathPlaceholder: 'D:\\models\\qwen3.gguf',
    nCtx: 'Context size',
    start: 'Raise the curtain',
    starting: 'Starting…',
    failed: 'Startup failed',
  },
  chat: {
    placeholder: 'Write to bonaparte…',
    errorPrefix: 'Error',
  },
  status: {
    stopped: 'stopped',
    starting: 'starting…',
    ready: 'ready',
    crashed: 'crashed',
    restarting: 'restarting…',
    restored: 'context restored',
    notRestored: 'cold start',
    reasons: {
      missing: 'no saved state',
      unsupported: 'backend without persistence',
      model: 'model changed',
      nCtx: 'context size changed',
      cacheType: 'KV quantization changed',
      buildTag: 'llama.cpp build changed',
      corrupt: 'corrupt manifest',
    },
    prefill: 'prefill',
    cacheShare: 'cache',
    save: 'Save state',
    saved: 'State saved',
    saveFailed: 'Save failed',
    changeBackend: 'Backend…',
  },
};

export const APP_LOCALES: Record<BonaparteLocale, AppTranslations> = {
  fr: FR,
  en: EN,
};
