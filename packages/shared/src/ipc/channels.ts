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
} from './conversations.js';
import { engineLlama, engineLlamaInstall, engineLoad, engineModels, engineState } from './engine.js';
import { modesGet, modesSet, toolsPreview } from './modes.js';
import { projectsChooseFolder, projectsCreate, projectsDetect, projectsList, projectsRemove, projectsUpdate } from './projects.js';
import { searchQuery } from './search.js';
import { appOpenDataFolder, conversationsExport, settingsAll, settingsGet, settingsSet } from './settings.js';

export const CHANNELS = [
  appInfo,
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
  searchQuery,
  settingsGet,
  settingsAll,
  settingsSet,
  conversationsExport,
  appOpenDataFolder,
] as const;
