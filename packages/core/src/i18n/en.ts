import type { HarnessTranslations } from './types.js';

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
