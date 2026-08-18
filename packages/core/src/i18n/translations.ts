/**
 * i18n du harness — pattern TS-typé repris de monaparte : une interface,
 * une constante par locale, zéro chargement dynamique. Les chaînes ici sont
 * celles émises par le harness lui-même (doctor, erreurs, statuts) ; l'UI de
 * l'app Electron a son propre fichier de traductions côté renderer.
 */

import type { BonaparteLocale } from '@aparte/bonaparte-shared';

export interface HarnessTranslations {
  doctor: {
    title: string;
    checkNode: string;
    checkLlamaServer: string;
    checkSlotSavePath: string;
    checkGpu: string;
    ok: string;
    fail: string;
    warn: string;
    allGood: string;
    hasBlockingIssues: string;
    lowDisk: string;
    cpuOnly: string;
    versionUnknown: string;
  };
  backend: {
    starting: string;
    ready: string;
    stopped: string;
    crashed: string;
    restarting: string;
    downloading: string;
  };
  kv: {
    saved: string;
    restored: string;
    restoreRefusedMismatch: string;
    reprefillNeeded: string;
  };
  errors: {
    llamaServerNotFound: string;
    llamaTooOld: string;
    slotSavePathNotWritable: string;
    modelFileNotFound: string;
    backendUnreachable: string;
  };
}

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

export const EN: HarnessTranslations = {
  doctor: {
    title: 'bonaparte diagnostic',
    checkNode: 'Node.js version',
    checkLlamaServer: 'llama-server binary',
    checkSlotSavePath: 'KV state directory (write access)',
    checkGpu: 'GPU detection',
    ok: 'OK',
    fail: 'FAIL',
    warn: 'WARNING',
    allGood: 'Everything looks good.',
    hasBlockingIssues: 'Blocking issues were detected.',
    lowDisk: 'Low disk space',
    cpuOnly: 'No GPU detected — running CPU-only',
    versionUnknown: 'version undetectable, slots compatibility not guaranteed',
  },
  backend: {
    starting: 'Starting the model server…',
    ready: 'Model server ready.',
    stopped: 'Model server stopped.',
    crashed: 'The model server stopped unexpectedly.',
    restarting: 'Restarting the model server…',
    downloading: 'Downloading llama-server…',
  },
  kv: {
    saved: 'Conversation context saved.',
    restored: 'Conversation context restored.',
    restoreRefusedMismatch:
      'Restore refused: the model configuration changed since this state was saved.',
    reprefillNeeded: 'The context must be fully recomputed (re-prefill).',
  },
  errors: {
    llamaServerNotFound:
      'llama-server not found — neither configured nor on the PATH.',
    llamaTooOld:
      'llama.cpp build too old for context persistence (slots) — please update.',
    slotSavePathNotWritable: 'The KV state directory is not writable.',
    modelFileNotFound: 'Model file not found.',
    backendUnreachable: 'The model server is not responding.',
  },
};

const LOCALES: Record<BonaparteLocale, HarnessTranslations> = { fr: FR, en: EN };

export function harnessT(locale: BonaparteLocale): HarnessTranslations {
  return LOCALES[locale];
}
