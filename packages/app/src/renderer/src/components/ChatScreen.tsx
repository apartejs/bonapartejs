import { AparteChat, useAparteChat } from '@aparte/react';
import type {
  AgentEventDto,
  CompletionStatsDto,
  ConversationEventDto,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { AsyncQueue } from '../lib/async-queue.js';

interface ChatScreenProps {
  initialEvents: ConversationEventDto[];
  onStats: (stats: CompletionStatsDto) => void;
  onStreamingChange: (streaming: boolean) => void;
}

let nextId = 0;
const freshId = (): string => `msg-${Date.now()}-${nextId++}`;

export function ChatScreen({
  initialEvents,
  onStats,
  onStreamingChange,
}: ChatScreenProps) {
  const { t } = useTranslate();

  const initialMessages = useMemo(
    () =>
      initialEvents.map((event) => ({
        id: freshId(),
        role: event.type === 'user' ? ('user' as const) : ('assistant' as const),
        content: event.text,
        timestamp: Date.parse(event.at) || Date.now(),
      })),
    [initialEvents],
  );

  const chat = useAparteChat(initialMessages);
  const activeQueue = useRef<AsyncQueue<string> | null>(null);

  useEffect(() => {
    const unsubscribe = window.bonaparte.onAgentEvent((event: AgentEventDto) => {
      const queue = activeQueue.current;
      if (!queue) return;
      if (event.type === 'token') {
        queue.push(event.text);
      } else if (event.type === 'done') {
        queue.close();
        activeQueue.current = null;
        onStats(event.stats);
        onStreamingChange(false);
      } else {
        queue.push(`\n${t.chat.errorPrefix} : ${event.message}`);
        queue.close();
        activeQueue.current = null;
        onStreamingChange(false);
      }
    });
    return unsubscribe;
  }, [onStats, onStreamingChange, t.chat.errorPrefix]);

  const handleSent = (detail: { content: string }): void => {
    const messageId = freshId();
    chat.appendMessage({
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });

    const queue = new AsyncQueue<string>();
    activeQueue.current = queue;
    onStreamingChange(true);

    void chat.injectTokenStream(messageId, queue);
    void window.bonaparte.sendMessage(detail.content);
  };

  return (
    <div className="chat-wrap">
      <AparteChat
        ref={chat.ref}
        messages={chat.messages}
        onMessagesChange={chat.setMessages}
        onMessageSent={handleSent}
        placeholder={t.chat.placeholder}
        centerWhenEmpty
      />
    </div>
  );
}
