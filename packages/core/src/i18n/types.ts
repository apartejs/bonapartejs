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
    /** `{min}` is replaced by the minimum major version. */
    nodeRequired: string;
    /** Unit of the free space figure (gibibytes). */
    gib: string;
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
  /** The OS notification when a reply finishes while bonaparte is not in front. */
  notifications: {
    /** `{title}`: the conversation. */
    replyReady: string;
    /** `{title}`: the conversation. */
    replyFailed: string;
    untitled: string;
  };
  /** Native file-picker filter names (shown by the OS dialog). */
  dialogs: {
    ggufModel: string;
    executable: string;
    allFiles: string;
  };
  errors: {
    llamaServerNotFound: string;
    llamaTooOld: string;
    slotSavePathNotWritable: string;
    modelFileNotFound: string;
    backendUnreachable: string;
  };
}
