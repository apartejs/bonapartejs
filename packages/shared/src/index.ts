/**
 * @aparte/bonaparte-shared — the contracts shared by the core, the Electron
 * app and the plugins. No workspace dependency: this package is a leaf of the
 * graph.
 */

export type { PlayMode, ToolEffect, Verdict } from './modes.js';
export { AGENT_ENDPOINT, APP_ORIGIN, APP_SCHEME } from './agent.js';
export { localize, parseManifest, PLUGIN_EFFECTS, pluginManifestSchema, pluginSourceSchema, usableEffects } from './plugins.js';
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
  PluginPty,
  PluginPtyOptions,
  PluginShell,
  TerminalService,
  WebSearchResult,
  WebSearchService,
  BrowserService,
  BrowserCaller,
  PluginBrowser,
  BrowserAction,
  BrowserConsoleLine,
  PluginSettingField,
  PluginCommandContribution,
  PluginSource,
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
export {
  APP_EVENT,
  pluginAddRequestSchema,
  pluginsAck,
  pluginsCheckUpdates,
  pluginsDiscard,
  pluginsInstall,
  pluginsInvoke,
  pluginsOverview,
  pluginsPickFolder,
  pluginsPreview,
  pluginsRemove,
  pluginsSetEnabled,
  pluginStatusSchema,
  searchKeysList,
  searchKeysSet,
  extensionsTry,
  extensionsInstall,
  extensionsCode,
  extensionsStop,
} from './ipc/plugins.js';
export type { PluginAddRequestView } from './ipc/plugins.js';
export type { AppEvent, CommandOutputView } from './ipc/plugins.js';
export { appliedChangeSchema, changesList, changesRevert, revertResultSchema } from './ipc/changes.js';
export type { AppliedChangeView, RevertResultView } from './ipc/changes.js';
export { changedFileSchema, fileEntrySchema, fileScopeSchema, filesChanged, filesList, filesRead, fileTextSchema } from './ipc/files.js';
export type { ChangedFileView, FileEntryView, FileScopeView, FileTextView } from './ipc/files.js';
export { diskScanStateSchema, modelsAddFolder, modelsScanCancel, modelsScanDisk, modelsScanState } from './ipc/models.js';
export type { DiskScanStateView } from './ipc/models.js';
export { engineDiskCheck, engineMemory, engineReleaseMemory, engineResources, resourceSampleSchema, type ResourceSampleView, engineRestart, engineUnload, memoryOverviewSchema, memoryRowSchema } from './ipc/memory.js';
export type { MemoryOverviewView, MemoryRowView } from './ipc/memory.js';
export { searchQuery, searchResultSchema } from './ipc/search.js';
export { probeResultSchema, providersAdd, providersList, providersModels, providersProbe, providersRemove, providersSwitch, providerViewSchema } from './ipc/providers.js';
export type { ProbeResultView, ProviderViewData } from './ipc/providers.js';
export { appOpenDataFolder, conversationsExport, settingsAll, settingsGet, settingsSet } from './ipc/settings.js';
export type { SearchResultView } from './ipc/search.js';
export {
  projectFactsSchema,
  projectSchema,
  projectsAddFolder,
  projectsChooseFolder,
  projectsCreate,
  projectsDetect,
  projectsFolderTaken,
  projectsList,
  projectsRemove,
  projectsUpdate,
} from './ipc/projects.js';
export type { ProjectFactsView, ProjectView } from './ipc/projects.js';
export { appInfo, localeSchema, windowTitleBar } from './ipc/app.js';
export type { Locale } from './ipc/app.js';
export {
  engineLlama,
  engineLlamaInstall,
  engineRuntimeDownload,
  VC_RUNTIME_DOWNLOAD,
  engineLlamaPick,
  engineModelDownload,
  engineRecommended,
  recommendedModelSchema,
  modelDownloadResultSchema,
  engineLoad,
  engineLoadResultSchema,
  engineModels,
  engineState,
  engineSwitch,
  engineSwitchCost,
  engineSwitchResultSchema,
  modelSwitchViewSchema,
  engineSettingsGet,
  engineLog,
  engineRestartCost,
  engineApplySettings,
  engineLaunchSettingsSchema,
  restartAnnouncementSchema,
  engineStateSchema,
  familyIdSchema,
  llamaCppStateSchema,
  llamaInstallResultSchema,
  loadAnnouncementSchema,
  modelChoiceSchema,
} from './ipc/engine.js';
export type {
  EngineLoadResult,
  EngineSwitchResult,
  ModelSwitchView,
  EngineLaunchSettingsView,
  RestartAnnouncementView,
  EngineStateView,
  LlamaCppStateView,
  LlamaInstallResult,
  ModelDownloadResult,
  RecommendedModelView,
  ModelChoiceView,
} from './ipc/engine.js';
export {
  conversationsLoadMeta,
  conversationsRename,
  conversationsPin,
  conversationsUnpin,
  conversationsOpenFolder,
  conversationsOpenPr,
  conversationsShowPr,
  conversationsArchiveCheck,
  conversationsCommitBranch,
  conversationsRewindPreview,
  conversationsRewind,
  conversationsUndoRewind,
  conversationsBranches,
  conversationsSwitchBranch,
  conversationsFollowPath,
  conversationsCompact,
  conversationsUncompact,
  conversationsContext,
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
  conversationsInbox,
  conversationsSeen,
  conversationsShown,
  conversationsReadAgain,
  conversationsSettingsGet,
  conversationsSettingsSet,
  type ConversationSettingsView,
  conversationsAttachProject,
  conversationsMove,
  type MoveReason,
  inboxSchema,
} from './ipc/conversations.js';
export type { ConversationCard } from './ipc/conversations.js';
export type { BranchView, ContextFullView, ConversationDocument, ConversationMemoryView, ConversationStatusView, InboxView, RewindWhatView } from './ipc/conversations.js';
export { modesGet, modesSet, modeViewSchema, playModeSchema, toolPreviewSchema, toolsPreview } from './ipc/modes.js';
export type { ModeView, ToolPreviewView } from './ipc/modes.js';
export { mcpAdd, mcpOverview, mcpPaste, mcpRemove, mcpServerViewSchema, mcpStart, mcpStop } from './ipc/mcp.js';
export type { McpServerViewData } from './ipc/mcp.js';
export { browserBack, browserCancelPick, browserCloseTab, browserConsole, browserConsoleLineSchema, browserHide, browserNavigate, browserOpenTab, browserPick, browserPins, browserPlace, browserReload, browserTabs, browserTabSchema, pickedElementSchema } from './ipc/browser.js';
export type { BrowserTabView, PickedElement } from './ipc/browser.js';
export { runsList, runsStart, runsStop, runViewSchema } from './ipc/runs.js';
export type { RunViewData } from './ipc/runs.js';
export { readFromView, readToView, VIEW_CHANNEL } from './plugin-view.js';
export type { FromView, ToView, ViewTheme } from './plugin-view.js';
export { appUpdateSchema, modelUpdateSchema, updatesKeep, updatesList, updatesLlama, updatesModel, updatesRestart, updatesSchema } from './ipc/updates.js';
export type { AppCheckView, AppUpdateView, ModelUpdateView, UpdatesView } from './ipc/updates.js';
