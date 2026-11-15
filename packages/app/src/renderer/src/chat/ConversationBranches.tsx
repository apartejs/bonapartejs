/**
 * « Brancher » (task 7.2): the branches of the conversation — made by going
 * back before a message, by a message changed, by an answer asked again —
 * each said by where it parts and what it says there; the one shown marked.
 * Picking one shows it. Opened from the header, it lists them all; from a
 * message, those that part from that message.
 */

import type { BranchView } from '@aparte/bonaparte-shared';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useMenu } from '../aparte/kit';
import { Icon } from '../shell/icons';
import type { Messages } from '../i18n/index';

export interface ConversationBranchesHandle {
  /** Opens the menu on the branches that part from the person's message `userIndex`. */
  openAt(userIndex: number): void;
}

export interface ConversationBranchesProps {
  messages: Messages;
  /** Reads the branches when the menu opens. */
  load(): Promise<BranchView[]>;
  onPick(branchId: string): void;
}

/** A branch parts from the person's message `index`: a message of its own there, or another answer to it. */
const partsAt = (branch: BranchView, index: number): boolean =>
  branch.startsWith === 'answer' ? branch.userIndex === index + 1 : branch.userIndex === index;

export const ConversationBranches = forwardRef<ConversationBranchesHandle, ConversationBranchesProps>(function ConversationBranches(props, ref) {
  const words = props.messages.forks;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [branches, setBranches] = useState<BranchView[] | null>(null);
  const at = useRef<number | null>(null);
  const [shownAt, setShownAt] = useState<number | null>(null);
  const load = useRef(props.load);
  load.current = props.load;
  useMenu(trigger, menu, {
    align: 'end',
    onOpen: () => {
      setShownAt(at.current);
      void load.current().then(setBranches, () => setBranches([]));
    },
    onClose: () => {
      at.current = null;
    },
  });
  useImperativeHandle(ref, () => ({
    openAt(userIndex) {
      at.current = userIndex;
      trigger.current?.click();
    },
  }));
  const pick = useRef(props.onPick);
  pick.current = props.onPick;
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const chosen = (event: Event): void => {
      const branchId = (event as CustomEvent<{ item: HTMLElement }>).detail.item.dataset['branch'];
      if (branchId) pick.current(branchId);
    };
    element.addEventListener('aparte-menu-select', chosen);
    return () => element.removeEventListener('aparte-menu-select', chosen);
  }, []);

  const shown = (branches ?? []).filter((branch) => shownAt === null || branch.active || partsAt(branch, shownAt));
  const others = shown.filter((branch) => !branch.active);
  return (
    <span className="aparte-app-header__actions conversation-branches">
      <button
        ref={trigger}
        type="button"
        className="aparte-btn aparte-btn--ghost aparte-btn--sm conversation-branches__button"
        aria-label={words.button}
        title={words.button}
      >
        <Icon name="branch" />
        <span>{words.button}</span>
      </button>
      <div ref={menu} className="aparte-menu conversation-branches__menu" role="menu" aria-label={words.menu} hidden>
        {shown.map((branch) => (
          <button
            key={branch.branchId}
            type="button"
            className="aparte-menu__item conversation-branches__item"
            role="menuitem"
            data-branch={branch.branchId}
            aria-current={branch.active || undefined}
          >
            <span className="conversation-branches__label">
              {branch.startsWith === 'message'
                ? words.message(branch.label)
                : branch.startsWith === 'answer'
                  ? words.answer(branch.label)
                  : words.wentBack}
            </span>
            <span className="conversation-branches__meta">
              {branch.active ? `${words.count(branch.messages)} · ${words.shown}` : words.count(branch.messages)}
            </span>
          </button>
        ))}
        {branches !== null && others.length === 0 ? <p className="conversation-branches__none">{words.none}</p> : null}
      </div>
    </span>
  );
});
