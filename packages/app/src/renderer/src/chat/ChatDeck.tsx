/**
 * The deck of live chats (task 5.5), as aparté's guide « Several live chats »
 * builds it: one `<AparteChat>` per live conversation, with its own id and its
 * own client scoped to it, bound to its conversation for its whole life; one
 * list beside them, which opens nothing by itself (its `target` is this deck,
 * no chat's id) — the page shows the chat of the conversation picked. A chat
 * not shown is still mounted: its reply goes on, its pause is asked again.
 *
 * What only the person acts on — the approval card, the toolbar — is given
 * to the chat shown.
 */

import type { AparteChatImperativeApi } from '@aparte/react';
import { AparteChat, useAparteClient } from '@aparte/react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { Messages } from '../i18n/index';
import type { Deck, LiveChat } from './deck';

/** The id the conversation list drives: the deck, no chat. */
export const CHATS_TARGET = 'bonaparte-chats';

type ClientOptions = Parameters<typeof useAparteClient>[0];

export interface ChatDeckProps {
  deck: Deck;
  messages: Messages;
  streamRunner: NonNullable<ClientOptions>['streamRunner'];
  approvalResolver: NonNullable<ClientOptions>['approvalResolver'];
  /** Each chat's handle, by its key, while it is mounted. */
  handles: Map<string, AparteChatImperativeApi>;
  /** A chat's first message made its conversation. */
  onCreated(key: string, conversationId: string): void;
  aboveComposer?: ReactNode;
  toolbar?: ReactNode;
}

function LiveChatView({
  chat,
  shown,
  props,
}: {
  chat: LiveChat;
  shown: boolean;
  props: ChatDeckProps;
}) {
  const { messages, handles, streamRunner, approvalResolver } = props;
  useAparteClient({ streamRunner, approvalResolver, scopeToTargetId: chat.key });
  const handle = useRef<AparteChatImperativeApi | null>(null);
  const ref = useCallback(
    (value: AparteChatImperativeApi | null) => {
      handle.current = value;
      if (value) handles.set(chat.key, value);
      else handles.delete(chat.key);
    },
    [chat.key, handles],
  );
  // A chat hidden cannot measure itself: shown again, it goes to its end.
  useEffect(() => {
    if (shown) handle.current?.scrollToBottom();
  }, [shown]);
  const created = props.onCreated;
  return (
    <div className="bonaparte-live-chat" data-chat-key={chat.key} hidden={!shown}>
      <AparteChat
        ref={ref}
        id={chat.key}
        conversationId={chat.conversationId}
        onConversationCreated={(id) => created(chat.key, id)}
        className="bonaparte-chat"
        centerWhenEmpty
        placeholder={messages.composer.placeholder}
        emptyState={<p className="bonaparte-empty">{messages.chat.empty}</p>}
        // The window is one page: a link in a reply never takes it away (the main process refuses too).
        onLinkClick={(_detail, event) => event.preventDefault()}
        aboveComposer={shown ? props.aboveComposer : undefined}
        toolbar={shown ? props.toolbar : undefined}
      />
    </div>
  );
}

export function ChatDeck(props: ChatDeckProps) {
  return (
    <div id={CHATS_TARGET} className="bonaparte-chats">
      {props.deck.chats.map((chat) => (
        <LiveChatView key={chat.key} chat={chat} shown={chat.key === props.deck.shown} props={props} />
      ))}
    </div>
  );
}
