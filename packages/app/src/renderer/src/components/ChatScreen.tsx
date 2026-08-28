import { requestUserInput, type AparteMessage, type AparteSegment } from '@aparte/core';
import { AparteChat, useAparteChat } from '@aparte/react';
import { Alert, AlertDescription, Button } from '@aparte/bonaparte-plugin-sdk/ui';
import { CircleAlert, TriangleAlert, X } from 'lucide-react';
import type {
  AgentEventDto,
  ApprovalRequestDto,
  ApprovalResponseDto,
  CompletionStatsDto,
  PlayModeDto,
  ConversationEventDto,
} from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** A recoverable error to show inline (a failed open, a crashed engine) — the chat stays put. */
  error: string | null;
  onDismissError: () => void;
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
 * The composer only knows a reply is in flight — and only offers Stop —
 * through the page's message lifecycle events, filtered by the chat it
 * targets. Without a client of the library running the turn, the screen
 * announces the turn itself: start when the message leaves, done when the
 * turn ends. A `status: 'streaming'` on the bubble is not read for that.
 */
function announceTurn(kind: 'start' | 'done'): void {
  const targetId = document.querySelector('aparte-composer')?.getAttribute('target') ?? undefined;
  window.dispatchEvent(new CustomEvent(`aparte-message-${kind}`, { detail: { targetId } }));
}

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
  error,
  onDismissError,
  onNeedsModel,
  autoSend,
  onAutoSent,
  approval,
  onApprovalResponse,
}: ChatScreenProps) {
  const { t } = useTranslate();
  // The composer's model menu, raised from the missing-model alert so a
  // recovery never leaves the chat.
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  // A conversation reads back the way it was seen: an assistant turn comes
  // with its segments — reasoning collapsed, tool calls with their outcome,
  // text — every one of them SETTLED (`isStreaming: false`), or the library
  // would hold them as still arriving, spinners included.
  const initialMessages = useMemo<AparteMessage[]>(
    () =>
      initialEvents.map((event) => {
        const id = freshId();
        const timestamp = Date.parse(event.at) || Date.now();
        if (event.type === 'user' || !event.segments) {
          return { id, role: event.type, content: event.text, timestamp };
        }
        const segments = event.segments.map((segment, index): AparteSegment => {
          const segmentId = `${id}-s${index}`;
          if (segment.kind === 'thinking') {
            return {
              id: segmentId,
              type: 'thinking',
              content: segment.text,
              label: t.chat.thinking,
              collapsed: true,
              isStreaming: false,
            };
          }
          if (segment.kind === 'tool') {
            return {
              id: segmentId,
              type: 'tool_call',
              status: segment.ok ? 'resolved' : 'aborted',
              toolCall: { id: segmentId, name: segment.name, input: segment.args },
              ...(segment.content !== undefined ? { result: segment.content } : {}),
              isStreaming: false,
            };
          }
          return { id: segmentId, type: 'text', content: segment.text, isStreaming: false };
        });
        return { id, role: 'assistant', content: '', timestamp, status: 'completed', segments };
      }),
    [initialEvents, t.chat.thinking],
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
      announceTurn('done');
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
          if (event.stats.truncated) {
            chatRef.current.addSegment({
              id: `seg-error-${state.seq++}`,
              type: 'error',
              content: t.chat.replyTruncated,
            });
          }
          finish(state, event.stats.truncated ? 'error' : 'completed');
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
              event.limit > 0
                ? t.chat.contextOverflow
                    .replace('{used}', String(event.used))
                    .replace('{limit}', String(event.limit))
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
    t.chat.replyTruncated,
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
        status: 'streaming',
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
      announceTurn('start');
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
      // `status: 'streaming'` is what tells the library a reply is in
      // flight: without it the composer's button stays a disabled Send, and
      // Stop does not exist. Measured on 0.15 (the audit of 2026-08-28).
      // An earlier version kept the bubble "awaiting" for the whole reply
      // under this status; since 0.14 a streaming bubble is never empty —
      // the waiting dots are its content until the first segment arrives.
      status: 'streaming',
    });
    turn.current = { messageId, thinking: null, text: null, pendingCalls: [], seq: 0 };
    onStreamingChange(true);
    announceTurn('start');
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

  // The composer's Stop. The library announces it on `window` as
  // `aparte-abort` (not bubbling from the composer): the engine cuts the
  // turn, what arrived stays, and the turn's end closes the bubble.
  useEffect(() => {
    const onAbort = (): void => {
      if (turn.current) void window.bonaparte.cancelMessage();
    };
    window.addEventListener('aparte-abort', onAbort);
    return () => window.removeEventListener('aparte-abort', onAbort);
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
    <div className="chat-wrap mx-auto flex min-h-0 w-full max-w-[920px] flex-1 flex-col px-4">
      {missingModel && (
        <Alert
          role="status"
          className="missing-model mt-3 shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
        >
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-2 text-current">
            <span className="flex-1">{t.chat.missingModel.replace('{name}', modelFileName(missingModel))}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-amber-600/40 bg-transparent text-current hover:bg-amber-500/15 hover:text-current"
              onClick={() => setModelPickerOpen(true)}
              disabled={busy}
            >
              {t.chat.chooseModel}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert
          role="alert"
          variant="destructive"
          className="chat-error mt-3 shrink-0"
        >
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span className="flex-1">{error}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-current"
              onClick={onDismissError}
              aria-label={t.common.clear}
            >
              <X className="size-3.5" />
            </Button>
          </AlertDescription>
        </Alert>
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
            <ModelSelector
              modelName={modelName}
              busy={busy}
              onPick={onPickModel}
              open={modelPickerOpen}
              onOpenChange={setModelPickerOpen}
            />
          </>
        }
      />
    </div>
  );
}
