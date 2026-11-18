/**
 * The person's tools on a page (task 10.2, board « Le navigateur et ses outils »): « Sélectionner un élément »
 * outlines what the pointer is over and shows the element clicked — its selector, where it sits, its text, size,
 * font and colour — to join to the conversation; « Commenter la page » pins numbered comments on the page, which
 * leave together in one message. The two tools exclude each other; Échap leaves either. The page is the main
 * process's: the picker runs there (`browser.pick`), and this pane keeps what it gave back.
 */

import { browserCancelPick, browserPick, browserPins, type PickedElement } from '@aparte/bonaparte-shared';
import { useEffect, useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';

export type PageTool = 'none' | 'select' | 'comment';

export interface PageComment {
  n: number;
  selector: string;
  x: number;
  y: number;
  text: string;
}

/** The accent as the page can draw it: the token, resolved to a colour by the window's own style. */
function accentNow(): string {
  const probe = document.createElement('span');
  probe.style.color = 'var(--aparte-primary)';
  probe.hidden = true;
  document.body.appendChild(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

/** What the element card says of an element, as the person reads it and as the message carries it. */
export function describeElement(element: PickedElement, messages: Messages): { selector: string; path: string; text: string; size: string; font: string; color: string } {
  return {
    selector: element.selector,
    path: element.path,
    text: element.text,
    size: `${element.width} × ${element.height}`,
    font: messages.browser.tools.fontOf(element.fontSize, element.bold),
    color: element.color,
  };
}

/**
 * The picker's loop: while a tool is on, the page is asked for the next element clicked; what it gives back is
 * the element shown (« Sélectionner ») or a new comment (« Commenter »). Échap in the page — or the tool switched
 * off, the tab changed, the page gone — ends it.
 */
export function usePageTools(tabId: string | null, url: string | undefined, loading: boolean | undefined) {
  const [tool, setTool] = useState<PageTool>('none');
  const [picked, setPicked] = useState<PickedElement | null>(null);
  const [comments, setComments] = useState<PageComment[]>([]);
  const focusComment = useRef<number | null>(null);

  useEffect(() => {
    if (tool === 'none' || !tabId || !url) return;
    let live = true;
    const loop = async (): Promise<void> => {
      while (live) {
        const element = await bridge.invoke(browserPick, { tabId, accent: accentNow() }).catch(() => null);
        if (!live) return;
        if (!element) {
          setTool('none');
          return;
        }
        if (tool === 'select') setPicked(element);
        else
          setComments((was) => {
            const n = Math.max(0, ...was.map((comment) => comment.n)) + 1;
            focusComment.current = n;
            return [...was, { n, selector: element.selector, x: element.x, y: element.y, text: '' }];
          });
      }
    };
    void loop();
    return () => {
      live = false;
      void bridge.invoke(browserCancelPick, { tabId });
    };
  }, [tool, tabId, url]);

  // Another page: what was shown or pinned there means nothing here.
  useEffect(() => {
    setPicked(null);
    setComments([]);
  }, [tabId, url]);

  // The pins follow the comments, and come back when the page is drawn again.
  useEffect(() => {
    if (!tabId || !url || loading) return;
    void bridge.invoke(browserPins, { tabId, accent: accentNow(), pins: comments.map(({ n, x, y }) => ({ n, x, y })) });
  }, [comments, tabId, url, loading]);

  const choose = (next: Exclude<PageTool, 'none'>): void => setTool((was) => (was === next ? 'none' : next));
  const comment = (element: PickedElement): void => {
    setComments((was) => {
      const n = Math.max(0, ...was.map((one) => one.n)) + 1;
      focusComment.current = n;
      return [...was, { n, selector: element.selector, x: element.x, y: element.y, text: '' }];
    });
    setPicked(null);
    setTool('comment');
  };

  return {
    tool,
    setTool,
    choose,
    picked,
    setPicked,
    comments,
    setComments,
    comment,
    focusComment,
  };
}

export interface ElementCardProps {
  messages: Messages;
  element: PickedElement;
  onAttach(): void;
  onComment(): void;
}

export function ElementCard({ messages, element, onAttach, onComment }: ElementCardProps) {
  const words = messages.browser.tools;
  const facts = describeElement(element, messages);
  return (
    <section className="aparte-card page-element" aria-label={facts.selector} data-picked={facts.selector}>
      <div className="page-element__head">
        <code className="page-element__selector">{facts.selector}</code>
        {facts.path ? <span className="page-element__path">{words.inPath(facts.path)}</span> : null}
      </div>
      <div className="page-element__facts">
        <span>
          {words.text}
          <b>{facts.text}</b>
        </span>
        <span>
          {words.size}
          {facts.size}
        </span>
        <span>
          {words.font}
          {facts.font}
        </span>
        <span>
          {words.color}
          {facts.color}
        </span>
      </div>
      <div className="page-element__actions">
        <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid aparte-btn--sm" onClick={onAttach}>
          {words.attach}
        </button>
        <button type="button" className="aparte-btn aparte-btn--outline aparte-btn--sm" onClick={onComment}>
          {words.commentThis}
        </button>
      </div>
    </section>
  );
}

export interface PageCommentsProps {
  messages: Messages;
  comments: readonly PageComment[];
  focus: { current: number | null };
  onChange(n: number, text: string): void;
  onRemove(n: number): void;
}

export function PageComments({ messages, comments, focus, onChange, onRemove }: PageCommentsProps) {
  const words = messages.browser.tools;
  return (
    <ol className="page-comments">
      {comments.map((comment) => (
        <li key={comment.n} className="page-comment" data-comment={comment.n}>
          <span className="aparte-badge aparte-badge--primary aparte-badge--solid page-comment__pin" aria-hidden="true">
            {comment.n}
          </span>
          <span className="page-comment__body">
            <code>{comment.selector}</code>
            <textarea
              className="aparte-field page-comment__field"
              rows={2}
              aria-label={words.commentField(comment.n)}
              placeholder={words.commentPlaceholder}
              value={comment.text}
              ref={(field) => {
                if (field && focus.current === comment.n) {
                  focus.current = null;
                  field.focus();
                }
              }}
              onChange={(event) => onChange(comment.n, event.target.value)}
            />
          </span>
          <button type="button" className="aparte-btn aparte-btn--icon aparte-btn--ghost aparte-btn--sm" aria-label={words.removeComment(comment.n)} onClick={() => onRemove(comment.n)}>
            <Icon name="close" />
          </button>
        </li>
      ))}
    </ol>
  );
}
