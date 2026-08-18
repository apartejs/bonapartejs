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
    const finish = (): void => {
      activeQueue.current?.close();
      activeQueue.current = null;
      onStreamingChange(false);
    };

    const unsubscribe = window.bonaparte.onAgentEvent((event: AgentEventDto) => {
      const queue = activeQueue.current;
      if (!queue) return;
      switch (event.type) {
        case 'token':
          queue.push(event.text);
          break;
        case 'thinking':
          break; // le raisonnement reste hors du fil en J2
        case 'tool_call':
          // Activité d'outil rendue dans le fil : l'utilisateur doit voir ce
          // que l'agent fait, pas seulement ce qu'il dit.
          queue.push(`\n\n▸ ${event.name}\n`);
          break;
        case 'tool_result': {
          const summary = event.content.split('\n')[0]?.slice(0, 200) ?? '';
          queue.push(`${event.ok ? '✓' : '✗'} ${summary}\n\n`);
          break;
        }
        case 'done':
          onStats(event.stats);
          finish();
          break;
        case 'error':
          queue.push(`\n${t.chat.errorPrefix} : ${event.message}`);
          finish();
          break;
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
        // Composer sans pièces jointes : le défaut de la lib monte un bouton
        // d'attachement, or notre boucle ne consomme pas encore detail.files —
        // mieux vaut ne rien promettre que jeter les fichiers en silence.
        composer={
          <div className="aparte-composer-shell">
            <div className="aparte-composer-row">
              <aparte-composer-input />
              <aparte-composer-send />
            </div>
          </div>
        }
      />
    </div>
  );
}
