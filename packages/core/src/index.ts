/**
 * @aparte/bonaparte-core — le harness de bonaparte.
 *
 * Node pur : ce paquet n'importe JAMAIS electron (frontière garantie par la
 * règle lint @nx/enforce-module-boundaries). Il est consommé par le main
 * process de l'app Electron ET par le CLI `npx @aparte/bonaparte`.
 */

export type { HarnessTranslations } from './i18n/translations.js';
export { EN, FR, harnessT } from './i18n/translations.js';

export type {
  DoctorCheck,
  DoctorCheckId,
  DoctorEnv,
  DoctorReport,
  DoctorStatus,
  GpuInfo,
} from './doctor/doctor.js';
export { LOW_DISK_BYTES, MIN_NODE_MAJOR, runDoctor } from './doctor/doctor.js';
export type { SystemDoctorEnvOptions } from './doctor/doctor-env.js';
export { createSystemDoctorEnv } from './doctor/doctor-env.js';

export { bonaparteDataDir, kvSlotsDir } from './paths.js';

export type {
  Backend,
  BackendCapabilities,
  BackendStatus,
  CompletionEvent,
  CompletionRequest,
  CompletionStats,
  PromptProgress,
  SamplingParams,
  ServerProps,
  SlotApi,
  SlotRestoreResult,
  SlotSaveResult,
} from './backend/types.js';
export { BackendRegistry } from './backend/registry.js';
export type { BackendType } from './backend/registry.js';
export {
  buildLlamaServerArgs,
  createLlamaCppBackend,
  detectServeCommandPrefix,
  LlamaCppHttpClient,
} from './backend/llamacpp/llamacpp-backend.js';
export type {
  LlamaCppBackendOptions,
  LlamaCppLaunchConfig,
  ManagedOptions,
  ProcessHandle,
  RemoteOptions,
  SpawnFn,
} from './backend/llamacpp/llamacpp-backend.js';
export { LlamaCppHttpError } from './backend/llamacpp/http-client.js';

export type {
  KvManifest,
  LiveBackendConfig,
  RestoreOutcome,
  RestoreRefusalReason,
  RestoreVerdict,
} from './kv/kv-store.js';
export { canRestore, KvStore } from './kv/kv-store.js';
export { fingerprintModelFile } from './kv/fingerprint.js';

export type { AssistantTurnOptions } from './wire/qwen-template.js';
export { PromptLog, renderSystem, renderUser } from './wire/qwen-template.js';

export type {
  ConversationEvent,
  ConversationMeta,
} from './conversation/store.js';
export { ConversationStore, rebuildPromptLog } from './conversation/store.js';

export type { ChatSessionOptions, OpenResult } from './session/chat-session.js';
export { ChatSession } from './session/chat-session.js';
