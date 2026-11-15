/**
 * @aparte/bonaparte-shared — the contracts shared by the core, the Electron
 * app and the plugins. No workspace dependency: this package is a leaf of the
 * graph.
 */

export type { PlayMode, ToolEffect, Verdict } from './modes.js';
export { AGENT_ENDPOINT, APP_ORIGIN, APP_SCHEME } from './agent.js';
export { localize, parseManifest, PLUGIN_EFFECTS, pluginManifestSchema, usableEffects } from './plugins.js';
export type {
  LocalizedText,
  PluginCommandHandler,
  PluginEffect,
  PluginInstanceChannel,
  PluginManifest,
  PluginManifestInput,
  PluginNodeContext,
  PluginNodeModule,
  PluginPaneContribution,
  PluginProcess,
  PluginSettingField,
  PluginSignal,
  PluginStatus,
  PluginToolContribution,
  PluginToolHandler,
  PluginToolInvocation,
  PluginToolResult,
  PluginToolUse,
} from './plugins.js';
export { defineChannel } from './ipc/contract.js';
export type { Bridge, Channel } from './ipc/contract.js';
export { CHANNELS } from './ipc/channels.js';
export { appliedChangeSchema, changesList, changesRevert, revertResultSchema } from './ipc/changes.js';
export type { AppliedChangeView, RevertResultView } from './ipc/changes.js';
export { changedFileSchema, fileEntrySchema, fileScopeSchema, filesChanged, filesList, filesRead, fileTextSchema } from './ipc/files.js';
export type { ChangedFileView, FileEntryView, FileScopeView, FileTextView } from './ipc/files.js';
export { diskScanStateSchema, modelsAddFolder, modelsScanCancel, modelsScanDisk, modelsScanState } from './ipc/models.js';
export type { DiskScanStateView } from './ipc/models.js';
export { engineMemory, engineReleaseMemory, engineRestart, engineUnload, memoryOverviewSchema, memoryRowSchema } from './ipc/memory.js';
export type { MemoryOverviewView, MemoryRowView } from './ipc/memory.js';
export { searchQuery, searchResultSchema } from './ipc/search.js';
export { appOpenDataFolder, conversationsExport, settingsAll, settingsGet, settingsSet } from './ipc/settings.js';
export type { SearchResultView } from './ipc/search.js';
export {
  projectFactsSchema,
  projectSchema,
  projectsAddFolder,
  projectsChooseFolder,
  projectsCreate,
  projectsDetect,
  projectsList,
  projectsRemove,
  projectsUpdate,
} from './ipc/projects.js';
export type { ProjectFactsView, ProjectView } from './ipc/projects.js';
export { appInfo, localeSchema } from './ipc/app.js';
export type { Locale } from './ipc/app.js';
export {
  engineLlama,
  engineLlamaInstall,
  engineLoad,
  engineLoadResultSchema,
  engineModels,
  engineState,
  engineStateSchema,
  familyIdSchema,
  llamaCppStateSchema,
  llamaInstallResultSchema,
  loadAnnouncementSchema,
  modelChoiceSchema,
} from './ipc/engine.js';
export type {
  EngineLoadResult,
  EngineStateView,
  LlamaCppStateView,
  LlamaInstallResult,
  ModelChoiceView,
} from './ipc/engine.js';
export {
  conversationsLoadMeta,
  conversationsRename,
  conversationsPin,
  conversationsUnpin,
  conversationsArchive,
  conversationsUnarchive,
  conversationsLoadDraft,
  conversationsSaveDraft,
  conversationCardSchema,
  conversationDocumentSchema,
  conversationMemorySchema,
  conversationsDelete,
  conversationsLoadAll,
  conversationsLoadFull,
  conversationsMemory,
  conversationsStatus,
  conversationsSave,
} from './ipc/conversations.js';
export type { ConversationCard } from './ipc/conversations.js';
export type { ConversationDocument, ConversationMemoryView, ConversationStatusView } from './ipc/conversations.js';
export { modesGet, modesSet, modeViewSchema, playModeSchema, toolPreviewSchema, toolsPreview } from './ipc/modes.js';
export type { ModeView, ToolPreviewView } from './ipc/modes.js';
