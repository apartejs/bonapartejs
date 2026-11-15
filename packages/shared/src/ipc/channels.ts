/**
 * Every channel between the window and the main process, in one list: what
 * the bridge carries is reviewed here as a whole (task 5.1). A channel added
 * to a domain's file is added here too — the main process's test checks it
 * serves exactly these.
 */

import { appInfo } from './app.js';
import {
  conversationsArchive,
  conversationsDelete,
  conversationsLoadAll,
  conversationsLoadDraft,
  conversationsLoadFull,
  conversationsLoadMeta,
  conversationsMemory,
  conversationsPin,
  conversationsStatus,
  conversationsRename,
  conversationsSave,
  conversationsSaveDraft,
  conversationsUnarchive,
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
} from './conversations.js';
import { engineLlama, engineLlamaInstall, engineLoad, engineModels, engineState } from './engine.js';
import { changesList, changesRevert } from './changes.js';
import { filesChanged, filesList, filesRead } from './files.js';
import { pluginsAck, pluginsInvoke } from './plugins.js';
import { modesGet, modesSet, toolsPreview } from './modes.js';
import { projectsAddFolder, projectsChooseFolder, projectsCreate, projectsDetect, projectsList, projectsRemove, projectsUpdate } from './projects.js';
import { engineMemory, engineReleaseMemory, engineRestart, engineUnload } from './memory.js';
import { modelsAddFolder, modelsScanCancel, modelsScanDisk, modelsScanState } from './models.js';
import { searchQuery } from './search.js';
import { appOpenDataFolder, conversationsExport, settingsAll, settingsGet, settingsSet } from './settings.js';

export const CHANNELS = [
  appInfo,
  filesList,
  filesRead,
  filesChanged,
  changesList,
  changesRevert,
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
  pluginsInvoke,
  pluginsAck,
  engineState,
  engineModels,
  engineLoad,
  engineLlama,
  engineLlamaInstall,
  conversationsLoadAll,
  conversationsLoadFull,
  conversationsLoadMeta,
  conversationsSave,
  conversationsDelete,
  conversationsMemory,
  conversationsStatus,
  conversationsRename,
  conversationsPin,
  conversationsUnpin,
  conversationsArchive,
  conversationsUnarchive,
  conversationsLoadDraft,
  conversationsSaveDraft,
  modesGet,
  modesSet,
  toolsPreview,
  projectsList,
  projectsDetect,
  projectsChooseFolder,
  projectsCreate,
  projectsUpdate,
  projectsRemove,
  projectsAddFolder,
  searchQuery,
  settingsGet,
  settingsAll,
  settingsSet,
  conversationsExport,
  appOpenDataFolder,
  modelsAddFolder,
  modelsScanDisk,
  modelsScanState,
  modelsScanCancel,
  engineMemory,
  engineReleaseMemory,
  engineUnload,
  engineRestart,
] as const;
