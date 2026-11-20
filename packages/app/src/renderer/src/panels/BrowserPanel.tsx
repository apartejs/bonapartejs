/**
 * The built-in browser's pane (task 10.1, board « Le navigateur et ses outils »): its tabs (« + », Ctrl T),
 * back, reload, the address, the screen size (« Ordinateur » or « Téléphone », 360 px), and « L'agent lit la
 * page » while the agent reads it. Its tabs are the person's and its conversation's agent's, marked « Agent »: the
 * agent's new page is shown unless the person looks at a tab of their own (the browser redo, step 2). The pages
 * are native views of the main process: this pane keeps a slot and
 * says where it is — and says « nowhere » whenever anything covers it (a dialog, a page over the
 * conversation, the pane hidden), since a native view sits above the window's page.
 */

import {
  browserBack,
  browserCloseTab,
  browserHide,
  browserNavigate,
  browserOpenTab,
  browserPlace,
  browserReload,
  browserTabs,
  type BrowserTabView,
} from '@aparte/bonaparte-shared';
import type { AparteComposerToken } from '@aparte/core';
import { useEffect, useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';
import { TipButton } from '../shell/TipButton';
import { BrowserConsole } from './BrowserConsole';
import { NewTab, type RunScope } from './NewTab';
import { describeElement, ElementCard, PageComments, usePageTools } from './PageTools';
import { useShortcut } from '../shortcuts/useShortcuts';

type Device = 'desktop' | 'phone';

/** How often the slot is measured again, besides its own resizes: a menu or a dialog may cover it. */
const MEASURE_EVERY_MS = 300;

let made = 0;
const newTabId = (): string => `tab-${Date.now().toString(36)}-${(made += 1)}`;

export interface BrowserPanelProps {
  messages: Messages;
  /** A page goes over the conversation (« À traiter », the settings): the page is taken off. */
  hidden: boolean;
  /** Whose project the new tab offers to run (task 10.3): the conversation shown, or the project chosen. */
  scope: RunScope;
  /** Something of the page joined to the message the person writes (task 10.2): a pill in the composer. */
  onAttach(token: AparteComposerToken): void;
  /** The page's comments, sent to the agent as one message. */
  onSend(text: string): void;
}

export function BrowserPanel({ messages, hidden, scope, onAttach, onSend }: BrowserPanelProps) {
  const words = messages.browser;
  const [tabs, setTabs] = useState<BrowserTabView[]>([]);
  const [reading, setReading] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [address, setAddress] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const slot = useRef<HTMLDivElement>(null);
  const placed = useRef<string>('');
  // The conversation whose tabs are shown — its agent's among them —, and the tab the main process said to show
  // last: followed only when it changes, so that a tab the person just chose is not taken back.
  const conversation = useRef<string | null>(scope.conversationId ?? null);
  conversation.current = scope.conversationId ?? null;
  const followed = useRef<string | null>(null);

  const ask = () => bridge.invoke(browserTabs, { conversationId: conversation.current });

  // A pane always has a tab of the person's — their last one closed, or only the agent's there —: a fresh one, once,
  // however many reads cross.
  const opening = useRef<Promise<void> | null>(null);
  const withATab = async (): Promise<Awaited<ReturnType<typeof ask>>> => {
    const first = await ask();
    if (first.tabs.some((tab) => !tab.agent)) return first;
    opening.current ??= bridge.invoke(browserOpenTab, { tabId: newTabId() }).finally(() => (opening.current = null));
    await opening.current;
    return ask();
  };

  const read = (): void => {
    void withATab().then((state) => {
      setTabs(state.tabs);
      setReading(state.reading);
      const moved = state.shown !== followed.current;
      followed.current = state.shown;
      const known = (id: string | null): id is string => id !== null && state.tabs.some((tab) => tab.tabId === id);
      setActive((current) => (moved && known(state.shown) ? state.shown : known(current) ? current : (state.shown ?? state.tabs.at(-1)?.tabId ?? null)));
    });
  };

  // Another conversation shown: its tabs, and the one it shows.
  useEffect(() => {
    followed.current = null;
    read();
  }, [scope.conversationId]);

  // The tabs read again whenever the main process says something changed (the first read is the conversation's).
  useEffect(() => {
    const off = bridge.on((event) => {
      if (event.kind === 'browser') read();
    });
    return () => {
      off();
      void bridge.invoke(browserHide, undefined);
    };
  }, []);

  const shown = tabs.find((tab) => tab.tabId === active) ?? null;
  // The address follows the tab shown, as long as the person is not typing in it.
  useEffect(() => {
    if (document.activeElement?.getAttribute('data-browser-address') === null || document.activeElement?.tagName !== 'INPUT') {
      setAddress(shown?.url ?? '');
    }
  }, [shown?.url, active]);

  // Where the tab shown goes: measured on every resize, and often, since something may cover it.
  useEffect(() => {
    const element = slot.current;
    if (!element || !active) return;
    const measure = (): void => {
      const covered = hidden || !element.checkVisibility() || document.querySelector('dialog[open]') !== null;
      const box = element.getBoundingClientRect();
      const rect = covered || !shown?.url ? null : { x: box.x, y: box.y, width: box.width, height: box.height };
      // Its conversation too: the main process shows an agent's page back in its own (the browser redo, step 2).
      const key = JSON.stringify([active, rect, device, conversation.current]);
      if (key === placed.current) return;
      placed.current = key;
      void bridge.invoke(browserPlace, { tabId: active, rect, device, conversationId: conversation.current });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    const timer = setInterval(measure, MEASURE_EVERY_MS);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      clearInterval(timer);
    };
  }, [active, device, hidden, shown?.url]);

  const openTab = async (): Promise<void> => {
    const tabId = newTabId();
    await bridge.invoke(browserOpenTab, { tabId });
    setActive(tabId);
    setAddress('');
    read();
  };

  // Ctrl T (task 12.1: its keys are the person's): a new tab, while the pane is shown.
  useShortcut('newTab', () => {
    if (hidden) return false;
    void openTab();
  });

  const closeTab = async (tabId: string): Promise<void> => {
    await bridge.invoke(browserCloseTab, { tabId });
    // Closing the last tab opens a fresh one: the read does (`withATab`).
    read();
  };

  const go = async (): Promise<void> => {
    if (!active || address.trim() === '') return;
    setFailure(null);
    const result = await bridge.invoke(browserNavigate, { tabId: active, url: address });
    if ('error' in result) setFailure(result.error);
    read();
  };

  const tools = usePageTools(shown?.url ? active : null, shown?.url, shown?.loading);
  const toolWords = words.tools;
  const written = tools.comments.filter((comment) => comment.text.trim() !== '');

  // Échap in the pane leaves the tool too (in the page, the picker hears it itself).
  useEffect(() => {
    if (tools.tool === 'none') return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') tools.setTool('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tools.tool]);

  const attachElement = (): void => {
    if (!tools.picked || !shown?.url) return;
    onAttach({
      label: tools.picked.selector,
      text: toolWords.elementMessage(describeElement(tools.picked, messages), shown.url),
      kind: 'page-element',
      data: { url: shown.url, selector: tools.picked.selector },
    });
    tools.setPicked(null);
    tools.setTool('none');
  };

  const sendComments = (): void => {
    if (!shown?.url || written.length === 0) return;
    onSend(toolWords.commentsMessage(shown.url, written));
    tools.setComments([]);
    tools.setTool('none');
  };

  const labelOf = (tab: BrowserTabView): string => (tab.url ? tab.title || tab.url.replace(/^https?:\/\//, '') : words.newTab);

  return (
    <div className="browser-pane">
      <div className="browser-pane__tabs">
        <div role="tablist" aria-label={words.tabs} className="browser-pane__tablist">
          {tabs.map((tab) => {
            const label = labelOf(tab);
            return (
              <div key={tab.tabId} className={`browser-tab${tab.tabId === active ? ' browser-tab--active' : ''}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.tabId === active}
                  className="browser-tab__label"
                  title={tab.url || label}
                  onClick={() => setActive(tab.tabId)}
                >
                  <Icon name="globe" />
                  {tab.agent ? <span className="aparte-badge aparte-badge--primary aparte-badge--soft aparte-badge--sm browser-tab__agent">{words.agentTab}</span> : null}
                  <span className="browser-tab__text">{label}</span>
                </button>
                <button type="button" className="browser-tab__close" aria-label={words.closeTab(label)} onClick={() => void closeTab(tab.tabId)}>
                  <Icon name="close" />
                </button>
              </div>
            );
          })}
        </div>
        <TipButton label={words.newTab} tip={words.newTabTip} icon="plus" side="bottom-end" onClick={() => void openTab()} />
      </div>

      <div className="browser-pane__toolbar">
        <TipButton label={words.back} tip={words.backTip} icon="back" side="bottom-start" disabled={!shown?.canGoBack} onClick={() => active && void bridge.invoke(browserBack, { tabId: active })} />
        <TipButton label={words.reload} tip={words.reloadTip} icon="reload" side="bottom-start" disabled={!shown?.url} onClick={() => active && void bridge.invoke(browserReload, { tabId: active })} />
        <div role="group" aria-label={toolWords.group} className="browser-pane__tools">
          <TipButton label={words.select} icon="pick" side="bottom-start" pressed={tools.tool === 'select'} disabled={!shown?.url} onClick={() => tools.choose('select')} />
          <TipButton label={words.comment} tip={words.commentTip} icon="comment" side="bottom-start" pressed={tools.tool === 'comment'} disabled={!shown?.url} onClick={() => tools.choose('comment')} />
        </div>
        <form
          className="browser-pane__address"
          onSubmit={(event) => {
            event.preventDefault();
            void go();
          }}
        >
          <input
            // Text, not `url`: the form's own validation would refuse an address without its scheme.
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            data-browser-address=""
            className="aparte-field"
            aria-label={words.address}
            placeholder={words.placeholder}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </form>
        <div role="group" aria-label={words.device} className="aparte-segmented aparte-segmented--sm browser-pane__device">
          {(['desktop', 'phone'] as const).map((one) => (
            <button key={one} type="button" className="aparte-segmented__item" aria-pressed={device === one} title={words[one]} onClick={() => setDevice(one)}>
              {words[one]}
            </button>
          ))}
        </div>
        {reading ? (
          <span className="browser-pane__reading" role="img" aria-label={words.readingLabel}>
            <Icon name="eye" />
            {words.reading}
          </span>
        ) : null}
      </div>

      {failure || shown?.error ? (
        <p className="aparte-field-warning browser-pane__failure" role="alert">
          {words.failed(failure ?? shown?.error ?? '')}
        </p>
      ) : null}

      {tools.tool === 'select' ? <p className="browser-pane__hint">{toolWords.selectHint}</p> : null}
      {tools.tool === 'comment' || tools.comments.length > 0 ? (
        <div className="browser-pane__hint browser-pane__hint--comments">
          <span className="browser-pane__hint-text">{toolWords.commentHint}</span>
          <span className="browser-pane__hint-count">{toolWords.comments(tools.comments.length)}</span>
          <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid aparte-btn--sm" disabled={written.length === 0} onClick={sendComments}>
            {toolWords.send}
          </button>
        </div>
      ) : null}

      <div className="browser-pane__viewport">
        {shown?.url ? (
          <div ref={slot} className={`browser-pane__slot browser-pane__slot--${device}`} data-testid="browser-slot" />
        ) : (
          <div ref={slot} className="browser-pane__empty">
            <NewTab
              messages={messages}
              scope={scope}
              onOpen={(url) => {
                setAddress(url);
                if (!active) return;
                void bridge.invoke(browserNavigate, { tabId: active, url }).then((result) => {
                  if ('error' in result) setFailure(result.error);
                  read();
                });
              }}
            />
          </div>
        )}
      </div>

      {tools.picked && shown?.url ? (
        <div className="browser-pane__tray">
          <ElementCard messages={messages} element={tools.picked} onAttach={attachElement} onComment={() => tools.picked && tools.comment(tools.picked)} />
        </div>
      ) : null}
      {tools.comments.length > 0 ? (
        <div className="browser-pane__tray">
          <PageComments
            messages={messages}
            comments={tools.comments}
            focus={tools.focusComment}
            onChange={(n, text) => tools.setComments((was) => was.map((comment) => (comment.n === n ? { ...comment, text } : comment)))}
            onRemove={(n) => tools.setComments((was) => was.filter((comment) => comment.n !== n))}
          />
        </div>
      ) : null}

      {shown?.url ? (
        <BrowserConsole
          messages={messages}
          tab={shown}
          onAttach={(lines) =>
            onAttach({
              label: words.console.errors(lines.length),
              text: toolWords.consoleMessage(shown.url, lines),
              kind: 'console-errors',
              data: { url: shown.url },
            })
          }
        />
      ) : null}
    </div>
  );
}
