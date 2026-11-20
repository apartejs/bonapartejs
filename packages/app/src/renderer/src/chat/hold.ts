/**
 * A conversation's chat held down while going back, its undo, or another branch shown (task 7.2): a new chat
 * stands in for it meanwhile, and the panes stay the conversation's as they were (the browser redo, step 2,
 * second review). The hold ends when the chat comes back — or when it cannot (third review).
 */

export interface BringBackDeps {
  /** The conversation's document as the core holds it now. */
  load(id: string): Promise<{ messages?: unknown[]; tree?: unknown } | null>;
  /** The conversation's messages as aparté's manager keeps them, replaced. */
  replaceMessages(id: string, messages: unknown[], tree: unknown): Promise<void>;
  /** The conversation's chat mounted again on what the manager holds. */
  mount(id: string): void;
  /** The hold ends: the panes follow the conversation shown again. */
  release(id: string): void;
  /** React has drawn what it was given. */
  settled(): Promise<void>;
}

/** The branch the core shows now, read again: the manager given it, the chat mounted on it. */
export async function bringBack(deps: BringBackDeps, id: string): Promise<void> {
  try {
    const document = await deps.load(id);
    if (document) await deps.replaceMessages(id, document.messages ?? [], document.tree);
    deps.mount(id);
    await deps.settled();
  } finally {
    // Back, or never coming back: either way the hold ends — never every conversation showing this one's panes.
    deps.release(id);
  }
}

/**
 * The conversation the panes and the diff's comments are for: the one held down while its stand-in is shown,
 * else the one shown.
 */
export function paneConversationOf(heldDown: string | null, shown: string | null): string | null {
  // The stand-in is a new chat (no conversation yet); the held chat mounted again is the conversation itself.
  return heldDown !== null && (shown === null || shown === heldDown) ? heldDown : shown;
}
