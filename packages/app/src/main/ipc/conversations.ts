/**
 * The conversation channels: aparté's storage adapter on the core's store,
 * and what opening a conversation costs. Glue: the core decides. The page
 * may save a conversation before its first turn reaches the core — the
 * conversation is made then, once.
 */

import type { Core } from '@aparte/bonaparte-core';
import {
  conversationsLoadMeta,
  conversationsRename,
  conversationsPin,
  conversationsUnpin,
  conversationsArchive,
  conversationsUnarchive,
  conversationsOpenPr,
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
  conversationsLoadDraft,
  conversationsSaveDraft,
  conversationsDelete,
  conversationsLoadAll,
  conversationsLoadFull,
  conversationsMemory,
  conversationsSave,
  conversationsStatus,
  conversationsInbox,
  conversationsSeen,
  conversationsReadAgain,
  type ConversationDocument,
  type ConversationMemoryView,
} from '@aparte/bonaparte-shared';
import type { IpcRegistry } from './register.js';

/** What a conversation the page makes is, until the window asks for another kind (5.3, 9.7). */
const NEW_CONVERSATION = { kind: 'code', engineId: 'builtin', modelId: '', mode: 'repetition' } as const;

interface ConversationCore {
  conversationStore: Pick<
    Core['conversationStore'],
    'ensure' | 'get' | 'list' | 'loadDocument' | 'saveDocument' | 'mark' | 'rename' | 'loadDraft' | 'saveDraft'
  >;
  conversationDocument: Core['conversationDocument'];
  conversations: Pick<Core['conversations'], 'open' | 'status' | 'markSeen' | 'readAgain'>;
  removeConversation: Core['removeConversation'];
  branchOf: Core['branchOf'];
  prOf: Core['prOf'];
  inbox: Core['inbox'];
  openPr: Core['openPr'];
  uncommitted: Core['uncommitted'];
  commitBranch: Core['commitBranch'];
  conversationArchived: Core['conversationArchived'];
  rewindPreview: Core['rewindPreview'];
  rewind: Core['rewind'];
  undoRewind: Core['undoRewind'];
  branches: Core['branches'];
  compact: Core['compact'];
  uncompact: Core['uncompact'];
  contextOf: Core['contextOf'];
}

export function registerConversationChannels(ipc: IpcRegistry, core: ConversationCore): void {
  const store = core.conversationStore;

  ipc.handle(conversationsLoadAll, async () => {
    const documents = await Promise.all((await store.list()).map((meta) => store.loadDocument(meta.id)));
    return documents.filter((document): document is ConversationDocument => document !== null);
  });

  // The page's document — or, when it is missing, the conversation rebuilt from its journal.
  ipc.handle(conversationsLoadFull, async ({ id }) => (await core.conversationDocument(id)) as ConversationDocument | null);

  // The sidebar's cards: read from the conversations' own cards, never from their documents.
  ipc.handle(conversationsLoadMeta, async () =>
    (await store.list()).map((meta) => ({
      id: meta.id,
      title: meta.title,
      createdAt: Date.parse(meta.createdAt),
      updatedAt: Date.parse(meta.updatedAt),
      ...(meta.pinnedAt ? { pinnedAt: Date.parse(meta.pinnedAt) } : {}),
      ...(meta.archivedAt ? { archivedAt: Date.parse(meta.archivedAt) } : {}),
    })),
  );
  const now = (): string => new Date().toISOString();
  ipc.handle(conversationsPin, async ({ id }) => void (await store.mark(id, { pinnedAt: now() })));
  ipc.handle(conversationsUnpin, async ({ id }) => void (await store.mark(id, { pinnedAt: undefined })));
  // Archived, its worktree is let go (kept 30 days); taken out, it is held again.
  ipc.handle(conversationsArchive, async ({ id }) => {
    await store.mark(id, { archivedAt: now() });
    await core.conversationArchived(id, true).catch(() => undefined);
  });
  ipc.handle(conversationsUnarchive, async ({ id }) => {
    await store.mark(id, { archivedAt: undefined });
    await core.conversationArchived(id, false).catch(() => undefined);
  });
  ipc.handle(conversationsOpenPr, ({ id }) => core.openPr(id));
  ipc.handle(conversationsArchiveCheck, async ({ id }) => ({ uncommitted: await core.uncommitted(id) }));
  ipc.handle(conversationsCommitBranch, async ({ id }) => {
    const meta = await store.get(id);
    return core.commitBranch(id, `bonaparte: ${meta?.title || id}`);
  });
  // Going back before a message (task 7.1): the core checks the message is the branch's, then moves.
  ipc.handle(conversationsRewindPreview, ({ id, userIndex, text }) => core.rewindPreview(id, { userIndex, text }));
  ipc.handle(conversationsRewind, ({ id, userIndex, text, what, messageId }) =>
    core.rewind(id, { userIndex, text }, what, messageId ? { messageId } : {}),
  );
  ipc.handle(conversationsUndoRewind, ({ id }) => core.undoRewind(id));
  // « Brancher » (task 7.2), and the sibling the person picks in the chat.
  ipc.handle(conversationsBranches, ({ id }) => core.branches.list(id));
  ipc.handle(conversationsSwitchBranch, ({ id, branchId }) => core.branches.switchTo(id, branchId));
  ipc.handle(conversationsFollowPath, ({ id, messageIds }) => core.branches.follow(id, messageIds));
  // Compaction (task 7.3): said first, done on the person's word.
  ipc.handle(conversationsCompact, ({ id }) => core.compact(id));
  ipc.handle(conversationsUncompact, ({ id }) => core.uncompact(id));
  ipc.handle(conversationsContext, ({ id }) => core.contextOf(id));
  ipc.handle(conversationsRename, async ({ id, title }) => void (await store.rename(id, title)));
  ipc.handle(conversationsLoadDraft, ({ id }) => store.loadDraft(id));
  ipc.handle(conversationsSaveDraft, ({ id, text }) => store.saveDraft(id, text));

  ipc.handle(conversationsSave, async ({ document }) => {
    const meta = await store.ensure(document.id, NEW_CONVERSATION);
    await store.saveDocument(document.id, document);
    // The title the page gave it (its first message, or the person's), on its card for the list.
    const title = typeof document['title'] === 'string' ? document['title'] : '';
    if (title !== meta.title) await store.rename(document.id, title);
  });

  ipc.handle(conversationsDelete, ({ id }) => core.removeConversation(id));

  ipc.handle(conversationsMemory, async ({ id }): Promise<ConversationMemoryView> => {
    const announcement = await core.conversations.open(id);
    return { announcement: announcement?.kind === 'restore' || announcement?.kind === 'reread' ? announcement : null };
  });

  ipc.handle(conversationsInbox, () => core.inbox());
  ipc.handle(conversationsSeen, ({ id }) => core.conversations.markSeen(id));
  ipc.handle(conversationsReadAgain, ({ id }) => core.conversations.readAgain(id));
  ipc.handle(conversationsStatus, async ({ ids }) => {
    const found = await Promise.all(
      ids.map(async (id) => {
        const status = await core.conversations.status(id);
        if (!status) return null;
        const meta = await store.get(id);
        // On its own branch: what it counts against its base (git, read when the window asks).
        const branch = meta?.worktree ? await core.branchOf(id).catch(() => null) : null;
        const pr = branch ? await core.prOf(id).catch(() => null) : null;
        const counted = branch
          ? {
              branch: { name: branch.name, base: branch.base, ahead: branch.ahead, added: branch.added, removed: branch.removed, files: branch.files },
              ...(pr ? { pr } : {}),
            }
          : {};
        return [id, { projectId: meta?.projectId ?? null, ...status, ...counted }] as const;
      }),
    );
    return Object.fromEntries(found.filter((entry) => entry !== null));
  });
}
