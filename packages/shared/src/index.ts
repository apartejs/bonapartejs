/**
 * @aparte/bonaparte-shared — the contracts shared by the core, the Electron
 * app and the plugins. No workspace dependency: this package is a leaf of the
 * graph.
 */

export type { PlayMode, ToolEffect, Verdict } from './modes.js';
export { AGENT_ENDPOINT, APP_ORIGIN, APP_SCHEME } from './agent.js';
export { defineChannel } from './ipc/contract.js';
export type { Bridge, Channel } from './ipc/contract.js';
export { CHANNELS } from './ipc/channels.js';
export {
  projectFactsSchema,
  projectSchema,
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
  conversationsSave,
} from './ipc/conversations.js';
export type { ConversationCard } from './ipc/conversations.js';
export type { ConversationDocument, ConversationMemoryView } from './ipc/conversations.js';
export { modesGet, modesSet, modeViewSchema, playModeSchema, toolPreviewSchema, toolsPreview } from './ipc/modes.js';
export type { ModeView, ToolPreviewView } from './ipc/modes.js';
