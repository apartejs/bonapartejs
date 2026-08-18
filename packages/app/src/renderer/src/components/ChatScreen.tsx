import { AparteChat, useAparteChat } from '@aparte/react';
import type {
  AgentEventDto,
  CompletionStatsDto,
  ConversationEventDto,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { SegmentWriter } from '../lib/segment-writer.js';

interface ChatScreenProps {
  initialEvents: ConversationEventDto[];
  onStats: (stats: CompletionStatsDto) => void;
  onStreamingChange: (streaming: boolean) => void;
}

let nextId = 0;
const freshId = (): string => `msg-${Date.now()}-${nextId++}`;

/**
 * Ce qui est ouvert dans le tour en cours. Un tour se compose de segments
 * successifs — raisonnement, texte, pastilles d'outils — et non d'un seul bloc
 * de texte : c'est ce qui permet de replier la réflexion et de montrer une
 * activité d'outil pendant qu'elle tourne.
 */
interface TurnState {
  thinking: string | null;
  /** Segment de texte courant ; remis à null après un outil (le texte suivant
   *  s'écrit alors APRÈS la pastille, dans un nouveau segment). */
  text: string | null;
  pendingCalls: { name: string; segmentId: string }[];
  seq: number;
}

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
  const turn = useRef<TurnState | null>(null);
  // Entre l'envoi et le premier signe de vie il peut s'écouler une minute
  // (prefill d'un gros contexte) : sans indicateur, l'app a l'air figée.
  // Le miroir en ref évite un setState par token pour rien.
  const [waiting, setWaiting] = useState(false);
  const waitingRef = useRef(false);
  const stopWaiting = (): void => {
    if (!waitingRef.current) return;
    waitingRef.current = false;
    setWaiting(false);
  };
  const stopWaitingRef = useRef(stopWaiting);
  stopWaitingRef.current = stopWaiting;

  // La ref suit `chat` sans le mettre en dépendance de l'effet : le hook
  // renvoie un objet neuf à chaque rendu, et l'abonnement IPC ne doit se
  // reconstruire qu'au montage.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  useEffect(() => {
    const writer = new SegmentWriter((segmentId, content) =>
      chatRef.current.appendToSegment(segmentId, content),
    );

    const ensureThinking = (state: TurnState): string => {
      if (state.thinking) return state.thinking;
      const id = `seg-think-${state.seq++}`;
      chatRef.current.addSegment({
        id,
        type: 'thinking',
        content: '',
        label: t.chat.thinking,
      });
      state.thinking = id;
      return id;
    };

    const ensureText = (state: TurnState): string => {
      if (state.text) return state.text;
      writer.flush();
      // La réflexion se replie dès que la réponse commence : visible pendant
      // qu'elle sert, discrète ensuite — mais jamais effacée.
      if (state.thinking) {
        chatRef.current.updateSegment(state.thinking, { collapsed: true });
        state.thinking = null;
      }
      const id = `seg-text-${state.seq++}`;
      chatRef.current.addSegment({ id, type: 'text', content: '' });
      state.text = id;
      return id;
    };

    /** Fin de tour : rien ne doit rester en attente ni tourner dans le vide. */
    const finish = (state: TurnState): void => {
      writer.flush();
      if (state.thinking) chatRef.current.updateSegment(state.thinking, { collapsed: true });
      // Un outil resté « pending » afficherait un spinner éternel : on dit
      // plutôt qu'il n'a pas abouti.
      for (const call of state.pendingCalls) {
        chatRef.current.updateSegment(call.segmentId, { status: 'aborted' });
      }
      turn.current = null;
      stopWaitingRef.current();
      onStreamingChange(false);
    };

    const unsubscribe = window.bonaparte.onAgentEvent((event: AgentEventDto) => {
      const state = turn.current;
      if (!state) return;
      stopWaitingRef.current();

      switch (event.type) {
        case 'token':
          writer.append(ensureText(state), event.text);
          break;

        case 'thinking':
          // Le raisonnement a sa place dans le fil : un modèle qui réfléchit
          // une minute sans rien afficher passe pour une app plantée.
          writer.append(ensureThinking(state), event.text);
          break;

        case 'tool_call': {
          writer.flush();
          if (state.thinking) {
            chatRef.current.updateSegment(state.thinking, { collapsed: true });
            state.thinking = null;
          }
          state.text = null;
          const id = `seg-tool-${state.seq++}`;
          chatRef.current.addSegment({
            id,
            type: 'tool_call',
            status: 'pending',
            toolCall: { id, name: event.name, input: event.args },
          });
          state.pendingCalls.push({ name: event.name, segmentId: id });
          break;
        }

        case 'tool_result': {
          writer.flush();
          // Les résultats reviennent dans l'ordre des appels ; à nom égal, le
          // plus ancien en attente est le bon.
          const index = state.pendingCalls.findIndex((c) => c.name === event.name);
          const call = index >= 0 ? state.pendingCalls.splice(index, 1)[0] : undefined;
          if (call) {
            chatRef.current.updateSegment(call.segmentId, {
              status: event.ok ? 'resolved' : 'aborted',
              result: event.content,
            });
          }
          break;
        }

        case 'done':
          onStats(event.stats);
          finish(state);
          break;

        case 'error':
          writer.flush();
          chatRef.current.addSegment({
            id: `seg-error-${state.seq++}`,
            type: 'error',
            content: `${t.chat.errorPrefix} : ${event.message}`,
          });
          finish(state);
          break;
      }
    });

    return () => {
      unsubscribe();
      writer.dispose();
    };
  }, [onStats, onStreamingChange, t.chat.errorPrefix, t.chat.thinking]);

  const handleSent = (detail: { content: string }): void => {
    chat.appendMessage({
      id: freshId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });
    turn.current = { thinking: null, text: null, pendingCalls: [], seq: 0 };
    waitingRef.current = true;
    setWaiting(true);
    onStreamingChange(true);
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
        isTyping={waiting}
        typingText={t.chat.waiting}
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
