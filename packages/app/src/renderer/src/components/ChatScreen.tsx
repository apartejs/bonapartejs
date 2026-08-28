import { requestUserInput } from '@aparte/core';
import { AparteChat, useAparteChat } from '@aparte/react';
import type {
  AgentEventDto,
  ApprovalRequestDto,
  ApprovalResponseDto,
  CompletionStatsDto,
  PlayModeDto,
  ConversationEventDto,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef } from 'react';
import { answerToResponse, approvalMessage, approvalOptions } from '../approval.js';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { modelFileName } from '../models/filter.js';
import { ModeSelector } from './ModeSelector.js';
import { ModelSelector } from './ModelSelector.js';
import { TemperatureControl } from './TemperatureControl.js';
import { ThinkingToggle } from './ThinkingToggle.js';

interface ChatScreenProps {
  initialEvents: ConversationEventDto[];
  onStats: (stats: CompletionStatsDto) => void;
  onStreamingChange: (streaming: boolean) => void;
  /** Play mode, mounted in the composer's footer: it decides the next turn. */
  mode: PlayModeDto;
  onModeChange: (mode: PlayModeDto) => void;
  /** Model of the conversation — pushed to the end of the row. */
  modelName: string | null;
  /** Open the conversation with a different model. */
  onPickModel: (modelPath: string) => void;
  /** An opening is in progress: the selector must not relaunch on top of it. */
  busy: boolean;
  /** Temperature is carried by the conversation: it's reread on change. */
  conversationId: string | null;
  /** The pinned model vanished from disk: a banner says so and offers the
   *  picker before anything is typed. */
  missingModel: string | null;
  onChooseModel: () => void;
  /** The engine refused to run without a model: the picker comes next, and
   *  the message that triggered it is handed over to be sent after the pick. */
  onNeedsModel: (event: { conversationId: string; missingModel?: string; text: string }) => void;
  /** A message held over the model pick: sent as soon as the screen mounts. */
  autoSend: string | null;
  onAutoSent: () => void;
  /** A tool call waiting for consent — asked on the library's panel, in this conversation only. */
  approval: ApprovalRequestDto | null;
  onApprovalResponse: (response: ApprovalResponseDto) => void;
}

let nextId = 0;
const freshId = (): string => `msg-${Date.now()}-${nextId++}`;

/**
 * What is open in the current turn. A turn is made of successive segments —
 * reasoning, text, tool chips — rather than a single block of text: this is
 * what allows collapsing the reasoning and showing a tool's activity while
 * it's running.
 */
interface TurnState {
  /**
   * The turn's assistant bubble. We keep it to be able to DECLARE the turn
   * finished: `updateMessage(id, { status })` is what makes the lib close
   * segments still open — final Markdown pass, highlighting of the last code
   * line, end timestamp. Without this call, `isStreaming` stays `undefined`,
   * which is not `false`: the lib considers every segment to still be
   * arriving, forever.
   */
  messageId: string;
  thinking: string | null;
  /** Current text segment; reset to null after a tool (the following text
   *  is then written AFTER the chip, in a new segment). */
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
  missingModel,
  onChooseModel,
  onNeedsModel,
  autoSend,
  onAutoSent,
  approval,
  onApprovalResponse,
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
  /** Last message sent: handed back with a `needs_model`, to be sent after the pick. */
  const lastSent = useRef('');

  // The ref tracks `chat` without putting it in the effect's dependencies:
  // the hook returns a new object on every render, and the IPC subscription
  // must only be rebuilt on mount.
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
        // EXPLICITLY open. Since 0.10.0, the absence of `collapsed` means
        // CLOSED (which is what mainstream assistants do) — and reasoning
        // collapsed while it's arriving is exactly the empty screen we
        // wanted to avoid: a minute of reasoning with nothing shown reads as
        // a crashed application. We collapse it ourselves as soon as the
        // reply starts.
        collapsed: false,
      });
      state.thinking = id;
      return id;
    };

    const ensureText = (state: TurnState): string => {
      if (state.text) return state.text;
      // The reasoning collapses as soon as the reply starts: visible while
      // it's useful, unobtrusive afterward — but never erased.
      if (state.thinking) {
        chatRef.current.updateSegment(state.thinking, { collapsed: true });
        state.thinking = null;
      }
      const id = `seg-text-${state.seq++}`;
      chatRef.current.addSegment({ id, type: 'text', content: '' });
      state.text = id;
      return id;
    };

    /** End of turn: nothing should be left spinning into the void. */
    const finish = (state: TurnState, status: 'completed' | 'error'): void => {
      if (state.thinking) chatRef.current.updateSegment(state.thinking, { collapsed: true });
      // A tool left "pending" would show an endless spinner: we say instead
      // that it didn't complete.
      for (const call of state.pendingCalls) {
        chatRef.current.updateSegment(call.segmentId, { status: 'aborted' });
      }
      // The turn is CLOSED, and the lib needs to be told: this call is what
      // closes the segments left open. This isn't a detail of state — it's
      // what triggers the final Markdown pass and the highlighting of the
      // current code line, deliberately left raw during the stream. Without
      // it, the last line of every code block stays gray, permanently.
      chatRef.current.updateMessage(state.messageId, { status });
      turn.current = null;
      onStreamingChange(false);
    };

    const unsubscribe = window.bonaparte.onAgentEvent((event: AgentEventDto) => {
      // A reply keeps streaming while another conversation is on screen:
      // its events are not ours to paint.
      if (event.conversationId !== conversationId) return;
      const state = turn.current;
      if (!state) return;

      switch (event.type) {
        case 'token':
          chatRef.current.appendToSegment(ensureText(state), event.text);
          break;

        case 'thinking':
          // The reasoning belongs in the thread: a model that thinks for a
          // minute without displaying anything looks like a crashed app.
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
          // Results come back in call order; for equal names, the oldest one
          // pending is the right one.
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
          finish(state, 'completed');
          break;

        case 'error':
          chatRef.current.addSegment({
            id: `seg-error-${state.seq++}`,
            type: 'error',
            content: `${t.chat.errorPrefix} : ${event.message}`,
          });
          finish(state, 'error');
          break;

        case 'context_overflow':
          // Nothing was sent: the message, with room for a reply, does not
          // fit in what the server holds. Said in the thread, where the
          // user reads; compaction (P2.5) will offer a way out.
          chatRef.current.addSegment({
            id: `seg-error-${state.seq++}`,
            type: 'error',
            // A remote engine declares no context size: no numbers to cite.
            content:
              event.nCtx > 0
                ? t.chat.contextOverflow
                    .replace('{used}', String(event.used))
                    .replace('{nCtx}', String(event.nCtx))
                : t.chat.contextOverflowUnknown,
          });
          finish(state, 'error');
          break;

        case 'needs_model':
          // Nothing to close: the turn never started. The empty bubble goes
          // with the screen, and the message comes back with the pick.
          turn.current = null;
          onStreamingChange(false);
          onNeedsModel({
            conversationId: event.conversationId,
            text: lastSent.current,
            ...(event.missingModel ? { missingModel: event.missingModel } : {}),
          });
          break;
      }
    });

    return unsubscribe;
  }, [
    conversationId,
    onNeedsModel,
    onStats,
    onStreamingChange,
    t.chat.contextOverflow,
    t.chat.contextOverflowUnknown,
    t.chat.errorPrefix,
    t.chat.thinking,
  ]);

  // Coming back to a conversation whose reply is still streaming: the
  // history on disk stops at the user's message, and the turn in flight is
  // painted from what the engine has so far — then the stream goes on.
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    void window.bonaparte.inFlight().then((partial) => {
      if (cancelled || !partial || partial.conversationId !== conversationId || turn.current) return;
      const messageId = freshId();
      chatRef.current.appendMessage({
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      });
      const state: TurnState = { messageId, thinking: null, text: null, pendingCalls: [], seq: 0 };
      if (partial.thinking) {
        const id = `seg-think-${state.seq++}`;
        chatRef.current.addSegment({
          id,
          type: 'thinking',
          content: partial.thinking,
          label: t.chat.thinking,
          collapsed: Boolean(partial.text),
        });
        if (!partial.text) state.thinking = id;
      }
      if (partial.text) {
        const id = `seg-text-${state.seq++}`;
        chatRef.current.addSegment({ id, type: 'text', content: partial.text });
        state.text = id;
      }
      turn.current = state;
      onStreamingChange(true);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, onStreamingChange, t.chat.thinking]);

  const handleSent = (detail: { content: string }): void => {
    // Empty assistant bubble: the lib renders it "awaiting" (animated dots,
    // aria-busy, no action bar) as long as nothing is written to it. Between
    // sending and the first token, a minute of prefill can go by.
    lastSent.current = detail.content;
    const messageId = freshId();
    chat.appendMessage({
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      // NO `status: 'streaming'` here, and this is measured: `isAwaitingReply()`
      // returns `true` as soon as the status is `streaming`, without looking
      // at the content — the bubble would therefore stay "awaiting" (animated
      // dots, `aria-busy`) throughout the whole reply. Without a status, the
      // awaiting state goes back to being what it should be: true as long as
      // there's nothing, false at the first segment. And `updateMessage({
      // status })` at the end of the turn closes the segments regardless of
      // what the prior state was.
    });
    turn.current = { messageId, thinking: null, text: null, pendingCalls: [], seq: 0 };
    onStreamingChange(true);
    void window.bonaparte.sendMessage(detail.content);
  };

  // A message typed before the model pick: the lib only appends what its
  // composer sends, so the user bubble is written here, then the turn runs
  // exactly as if it had just been sent. Once — the guard covers a double
  // mount in development.
  const autoSent = useRef(false);
  useEffect(() => {
    if (!autoSend || autoSent.current) return;
    autoSent.current = true;
    chat.appendMessage({ id: freshId(), role: 'user', content: autoSend, timestamp: Date.now() });
    handleSent({ content: autoSend });
    onAutoSent();
  });

  // The library presents questions through an <aparte-elicitation> INSIDE the
  // chat — without one, requestUserInput() rejects at once (it says so in the
  // console). The React wrapper has no slot for it, so it is placed by hand
  // once the chat is in the DOM, and removed with the screen.
  useEffect(() => {
    // The React wrapper is a framework host: a [data-aparte-chat] container,
    // not an <aparte-chat> element.
    const host = document.querySelector('aparte-chat, [data-aparte-chat]');
    if (!host || host.querySelector('aparte-elicitation')) return;
    const presenter = document.createElement('aparte-elicitation');
    host.append(presenter);
    return () => presenter.remove();
  }, []);

  // Consent for a tool call, on apartéJS's approval panel: inline in the
  // composer, where the answer is typed, with OUR three options (the
  // library fixes none — only the requester knows what it can honour).
  // Leaving the screen aborts the panel; the request stays pending in the
  // app and is asked again when this conversation comes back.
  useEffect(() => {
    if (!approval || approval.conversationId !== conversationId) return;
    const controller = new AbortController();
    void requestUserInput({
      message: approvalMessage(t.approval, approval),
      kind: 'approval',
      options: approvalOptions(t.approval),
      signal: controller.signal,
    })
      .then((result) => onApprovalResponse(answerToResponse(approval.id, result)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [approval, conversationId, onApprovalResponse, t.approval]);

  return (
    <div className="chat-wrap">
      {missingModel && (
        <div className="aparte-alert aparte-alert--warning missing-model" role="status">
          <div className="aparte-alert__body">
            <p className="aparte-alert__message">
              {t.chat.missingModel.replace('{name}', modelFileName(missingModel))}
            </p>
            <button
              type="button"
              className="aparte-btn aparte-btn--warning aparte-btn--soft aparte-btn--sm"
              onClick={onChooseModel}
              disabled={busy}
            >
              {t.chat.chooseModel}
            </button>
          </div>
        </div>
      )}
      <AparteChat
        ref={chat.ref}
        messages={chat.messages}
        onMessagesChange={chat.setMessages}
        onMessageSent={handleSent}
        placeholder={t.chat.placeholder}
        centerWhenEmpty
        // No attachments: the lib strips them by default, and our loop
        // doesn't consume `detail.files` yet — better to promise nothing
        // than to silently drop the files.
        //
        // The composer's toolbar carries what conditions the NEXT message:
        // what the agent is allowed to do, and who will answer.
        //
        // A single slot since 0.7.0, and the order is the DOM's: the three
        // positional slots before named a PHYSICAL position ("right"), which
        // contradicts reading direction in RTL. The model pushes its line
        // end with `margin-inline-start: auto`, a LOGICAL property — hence
        // correct in both directions.
        toolbar={
          <>
            <ModeSelector mode={mode} onModeChange={onModeChange} />
            <ThinkingToggle conversationId={conversationId} />
            <TemperatureControl conversationId={conversationId} />
            {/* The model belongs to the conversation, like the mode and the
                temperature: it is therefore chosen in the same place, not by
                creating a conversation. */}
            <ModelSelector modelName={modelName} busy={busy} onPick={onPickModel} />
          </>
        }
      />
    </div>
  );
}
