/**
 * Every channel between the window and the main process, in one list: what
 * the bridge carries is reviewed here as a whole (task 5.1). A channel added
 * to a domain's file is added here too — the main process's test checks it
 * serves exactly these.
 */

import { appInfo } from './app.js';
import { conversationsDelete, conversationsLoadAll, conversationsLoadFull, conversationsMemory, conversationsSave } from './conversations.js';
import { engineLlama, engineLlamaInstall, engineLoad, engineModels, engineState } from './engine.js';
import { modesGet, modesSet, toolsPreview } from './modes.js';

export const CHANNELS = [
  appInfo,
  engineState,
  engineModels,
  engineLoad,
  engineLlama,
  engineLlamaInstall,
  conversationsLoadAll,
  conversationsLoadFull,
  conversationsSave,
  conversationsDelete,
  conversationsMemory,
  modesGet,
  modesSet,
  toolsPreview,
] as const;
