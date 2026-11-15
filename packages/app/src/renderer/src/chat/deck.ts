/**
 * The deck of live chats (task 5.5): one aparté chat per live conversation,
 * each bound to its conversation for its whole life (aparté's « several live
 * chats »). The one shown, those that work or wait for the person, and the
 * four seen last stay mounted — a reply goes on while the person looks
 * elsewhere, a pause is asked again —; the others are let go, and come back
 * from storage when opened.
 */

export interface LiveChat {
  /** The chat's id: what its client is scoped to. */
  key: string;
  /** Its conversation; null until its first message makes one. */
  conversationId: string | null;
}

export interface Deck {
  chats: readonly LiveChat[];
  shown: string;
  /** The chats seen, the last first. */
  recent: readonly string[];
  next: number;
}

/** How many chats stay mounted beside the one shown, for having been seen last. */
export const RECENT_KEPT = 4;

export function newDeck(): Deck {
  return { chats: [{ key: 'chat-1', conversationId: null }], shown: 'chat-1', recent: ['chat-1'], next: 2 };
}

export function shownConversation(deck: Deck): string | null {
  return deck.chats.find((chat) => chat.key === deck.shown)?.conversationId ?? null;
}

function show(deck: Deck, key: string): Deck {
  return { ...deck, shown: key, recent: [key, ...deck.recent.filter((seen) => seen !== key)] };
}

function mount(deck: Deck, conversationId: string | null): { deck: Deck; key: string } {
  const key = `chat-${deck.next}`;
  return { deck: { ...deck, chats: [...deck.chats, { key, conversationId }], next: deck.next + 1 }, key };
}

/** Opens a conversation — or a new one, for null: its chat when it lives, else one mounted for it. */
export function openIn(deck: Deck, conversationId: string | null): Deck {
  const live = deck.chats.find((chat) => chat.conversationId === conversationId);
  if (live) return show(deck, live.key);
  const made = mount(deck, conversationId);
  return show(made.deck, made.key);
}

/** A chat's first message made its conversation. */
export function created(deck: Deck, key: string, conversationId: string): Deck {
  return { ...deck, chats: deck.chats.map((chat) => (chat.key === key ? { ...chat, conversationId } : chat)) };
}

/** Mounts, without showing them, the conversations that wait for the person (a pause before a restart). */
export function mountHidden(deck: Deck, conversationIds: readonly string[]): Deck {
  let next = deck;
  for (const id of conversationIds) {
    if (!next.chats.some((chat) => chat.conversationId === id)) next = mount(next, id).deck;
  }
  return next;
}

/**
 * Lets go the chats that need not live: never the one shown, nor one `keep` holds (it works, or it
 * waits for the person), nor the four seen last before the one shown — an empty chat not shown goes.
 */
export function prune(deck: Deck, keep: (chat: LiveChat) => boolean, recentKept = RECENT_KEPT): Deck {
  const seen = new Set(deck.recent.filter((key) => key !== deck.shown).slice(0, recentKept));
  const chats = deck.chats.filter(
    (chat) => chat.key === deck.shown || keep(chat) || (chat.conversationId !== null && seen.has(chat.key)),
  );
  if (chats.length === deck.chats.length) return deck;
  const living = new Set(chats.map((chat) => chat.key));
  return { ...deck, chats, recent: deck.recent.filter((key) => living.has(key)) };
}

/** A conversation archived or deleted: its chat goes; if it was shown, a new conversation is. */
export function forget(deck: Deck, conversationId: string): Deck {
  const gone = deck.chats.find((chat) => chat.conversationId === conversationId);
  if (!gone) return deck;
  const left: Deck = {
    ...deck,
    chats: deck.chats.filter((chat) => chat.key !== gone.key),
    recent: deck.recent.filter((key) => key !== gone.key),
  };
  return gone.key === deck.shown ? openIn(left, null) : left;
}
