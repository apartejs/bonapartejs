/**
 * Contract for the harness translations. One locale = one file (fr.ts,
 * en.ts), all typed by this interface: a missing key = a compile error,
 * and parity is also verified by the specs.
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
