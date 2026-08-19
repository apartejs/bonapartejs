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
  ProviderEvent,
  SystemSpec,
  ToolCall,
  ToolDefLike,
  ToolOutcome,
  TranscriptEntry,
  TurnRequest,
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
  CreateConversationOptions,
} from './conversation/store.js';
export { ConversationStore, rebuildTranscript } from './conversation/store.js';

export type { DiscoveredModel, ModelSource, ScanOptions, ScanRoot } from './models/inventory.js';
export { defaultScanRoots, scanModels } from './models/inventory.js';
export {
  isSupportedLlamaBuild,
  MIN_LLAMA_BUILD,
  parseLlamaBuildNumber,
} from './backend/llamacpp/version.js';

export type { ChatSessionOptions, OpenResult } from './session/chat-session.js';
export { ChatSession } from './session/chat-session.js';

export type {
  ParsedOutput,
  ParsedToolCall,
} from './wire/hermes-parser.js';
export { parseHermesOutput } from './wire/hermes-parser.js';
export { HermesStreamDemux } from './wire/stream-demux.js';
export type { DemuxEvent } from './wire/stream-demux.js';
export type { SystemPromptOptions } from './wire/system-prompt.js';
export {
  buildSystemPrompt,
  renderInventoryDelta,
  renderToolInventory,
  renderToolResults,
} from './wire/system-prompt.js';

export type {
  RegisteredTool,
  ToolContext,
  ToolDef,
  ToolEffect,
  ToolHandler,
  ToolInventoryDelta,
  ToolInventorySnapshot,
  ToolResult,
  ToolSource,
} from './tools/types.js';
export { ToolRegistry } from './tools/registry.js';
export type { GrammarConstraint } from './tools/grammar.js';
export { buildGrammarConstraint, buildToolCallGrammar } from './tools/grammar.js';
export type { BuiltinTool } from './tools/builtin/index.js';
export { builtinTools, MAX_TOOL_OUTPUT_CHARS } from './tools/builtin/index.js';

export type {
  AllowRule,
  PermissionDecision,
  PermissionQuery,
  PlayMode,
} from './permissions/engine.js';
export { PermissionEngine, PLAY_MODES } from './permissions/engine.js';

export type {
  AgentEvent,
  AgentLoopOptions,
  ApprovalRequest,
  ApprovalResolver,
} from './agent/loop.js';
export { AgentLoop } from './agent/loop.js';

export { displayPath, PathOutsideProjectError, resolveInProject } from './project/paths.js';

export type {
  DiscoveredPlugin,
  PluginHostOptions,
  PluginNodeContext,
  PluginNodeModule,
  PluginToolHandler,
  PluginToolInvocation,
  PluginToolResult,
} from './plugins/host.js';
export { PLUGIN_MANIFEST_FILE, PluginHost } from './plugins/host.js';
// La surface publique de l'hôte parle le contrat partagé : le ré-exporter
// garde les déclarations générées autoportantes.
export type {
  AgentToolContribution,
  PluginConfigField,
  PluginManifest,
  PluginStatusDto,
  ToolingViewContribution,
} from '@aparte/bonaparte-shared';

export type { EndpointProbe, ProbeOptions } from './backend/detect-endpoint.js';
export { probeEndpoint } from './backend/detect-endpoint.js';
export type {
  ResolvedSetting,
  SettingField,
  SettingLayers,
  SettingOption,
  SettingScope,
  SettingsLayer,
} from './settings/resolve.js';
export { resolveSettings } from './settings/resolve.js';
export {
  HARNESS_SETTINGS,
  KV_INVALIDATING_KEYS,
  LAUNCH_SETTINGS,
  SAMPLING_SETTINGS,
} from './settings/catalog.js';
