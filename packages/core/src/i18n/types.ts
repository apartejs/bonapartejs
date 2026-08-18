/**
 * Contrat des traductions du harness. Une locale = un fichier (fr.ts, en.ts),
 * tous typés par cette interface : une clé manquante = erreur de compilation,
 * et la parité est aussi vérifiée par les specs.
 */

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
