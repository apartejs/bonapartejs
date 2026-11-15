/**
 * The conversation channels: aparté's storage adapter on the core's store,
 * and what opening a conversation costs. Glue: the core decides. The page
 * may save a conversation before its first turn reaches the core — the
 * conversation is made then, once.
 */

import type { Core } from '@aparte/bonaparte-core';
import {
  conversationsDelete,
  conversationsLoadAll,
  conversationsLoadFull,
  conversationsMemory,
  conversationsSave,
  type ConversationDocument,
  type ConversationMemoryView,
} from '@aparte/bonaparte-shared';
import type { IpcRegistry } from './register.js';

/** What a conversation the page makes is, until the window asks for another kind (5.3, 9.7). */
const NEW_CONVERSATION = { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' } as const;

interface ConversationCore {
  conversationStore: Pick<Core['conversationStore'], 'ensure' | 'list' | 'loadDocument' | 'saveDocument'>;
  conversations: Pick<Core['conversations'], 'open'>;
  removeConversation: Core['removeConversation'];
}

export function registerConversationChannels(ipc: IpcRegistry, core: ConversationCore): void {
  const store = core.conversationStore;

  ipc.handle(conversationsLoadAll, async () => {
    const documents = await Promise.all((await store.list()).map((meta) => store.loadDocument(meta.id)));
    return documents.filter((document): document is ConversationDocument => document !== null);
  });

  ipc.handle(conversationsLoadFull, async ({ id }) => (await store.loadDocument(id)) as ConversationDocument | null);

  ipc.handle(conversationsSave, async ({ document }) => {
    await store.ensure(document.id, NEW_CONVERSATION);
    await store.saveDocument(document.id, document);
  });

  ipc.handle(conversationsDelete, ({ id }) => core.removeConversation(id));

  ipc.handle(conversationsMemory, async ({ id }): Promise<ConversationMemoryView> => {
    const announcement = await core.conversations.open(id);
    return { announcement: announcement?.kind === 'restore' || announcement?.kind === 'reread' ? announcement : null };
  });
}
