import { AparteChat, useAparteChat } from '@aparte/react';
import type {
  AgentEventDto,
  CompletionStatsDto,
  PlayModeDto,
  ConversationEventDto,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { ModeSelector } from './ModeSelector.js';
import { ModelSelector } from './ModelSelector.js';
import { TemperatureControl } from './TemperatureControl.js';

interface ChatScreenProps {
  initialEvents: ConversationEventDto[];
  onStats: (stats: CompletionStatsDto) => void;
  onStreamingChange: (streaming: boolean) => void;
  /** Mode de jeu, monté dans le pied du composeur : il décide du prochain tour. */
  mode: PlayModeDto;
  onModeChange: (mode: PlayModeDto) => void;
  /** Modèle de la conversation — poussé en fin de rangée. */
  modelName: string | null;
  /** Ouvrir la conversation avec un autre modèle. */
  onPickModel: (modelPath: string) => void;
  /** Une ouverture est en cours : le sélecteur ne doit pas relancer par-dessus. */
  busy: boolean;
  /** La température est portée par la conversation : elle se relit au changement. */
  conversationId: string | null;
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
  mode,
  onModeChange,
  modelName,
  onPickModel,
  busy,
  conversationId,
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

  // La ref suit `chat` sans le mettre en dépendance de l'effet : le hook
  // renvoie un objet neuf à chaque rendu, et l'abonnement IPC ne doit se
  // reconstruire qu'au montage.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  useEffect(() => {
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

    /** Fin de tour : rien ne doit rester à tourner dans le vide. */
    const finish = (state: TurnState): void => {
      if (state.thinking) chatRef.current.updateSegment(state.thinking, { collapsed: true });
      // Un outil resté « pending » afficherait un spinner éternel : on dit
      // plutôt qu'il n'a pas abouti.
      for (const call of state.pendingCalls) {
        chatRef.current.updateSegment(call.segmentId, { status: 'aborted' });
      }
      turn.current = null;
      onStreamingChange(false);
    };

    const unsubscribe = window.bonaparte.onAgentEvent((event: AgentEventDto) => {
      const state = turn.current;
      if (!state) return;

      switch (event.type) {
        case 'token':
          chatRef.current.appendToSegment(ensureText(state), event.text);
          break;

        case 'thinking':
          // Le raisonnement a sa place dans le fil : un modèle qui réfléchit
          // une minute sans rien afficher passe pour une app plantée.
          chatRef.current.appendToSegment(ensureThinking(state), event.text);
          break;

        case 'tool_call': {
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
          chatRef.current.addSegment({
            id: `seg-error-${state.seq++}`,
            type: 'error',
            content: `${t.chat.errorPrefix} : ${event.message}`,
          });
          finish(state);
          break;
      }
    });

    return unsubscribe;
  }, [onStats, onStreamingChange, t.chat.errorPrefix, t.chat.thinking]);

  const handleSent = (detail: { content: string }): void => {
    // Bulle assistante vide : la lib la rend « en attente » (points animés,
    // aria-busy, pas de barre d'actions) tant que rien n'y est écrit. Entre
    // l'envoi et le premier token il peut s'écouler une minute de prefill.
    chat.appendMessage({
      id: freshId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });
    turn.current = { thinking: null, text: null, pendingCalls: [], seq: 0 };
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
        centerWhenEmpty
        // Pas de pièces jointes : la lib les coupe par défaut, et notre boucle
        // ne consomme pas encore `detail.files` — mieux vaut ne rien promettre
        // que jeter les fichiers en silence.
        //
        // La barre d'outils du composeur porte ce qui conditionne le PROCHAIN
        // message : ce que l'agent s'autorise, et qui va répondre.
        //
        // Un seul slot depuis 0.7.0, et l'ordre est celui du DOM : les trois
        // slots positionnels d'avant nommaient une position PHYSIQUE
        // (« right »), ce qui contredit le sens de lecture en RTL. Le modèle
        // pousse sa fin de ligne avec `margin-inline-start: auto`, propriété
        // LOGIQUE — donc juste dans les deux sens.
        toolbar={
          <>
            <ModeSelector mode={mode} onModeChange={onModeChange} />
            <TemperatureControl conversationId={conversationId} />
            {/* Le modèle appartient à la conversation, comme le mode et la
                température : il se choisit donc au même endroit, et non en
                créant une conversation. */}
            <ModelSelector modelName={modelName} busy={busy} onPick={onPickModel} />
          </>
        }
      />
    </div>
  );
}
