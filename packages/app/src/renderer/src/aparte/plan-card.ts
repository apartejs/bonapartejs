/**
 * The plan card (board « Le mode plan au travail »): aparté's plan card draws
 * the steps of an `update_plan` call (`setupPlanCard`); under it, what that
 * card has no place for — the files the plan touches, the questions left to
 * settle on the way — and, while the conversation is in Lecture, its three
 * actions: « Lancer en Plume », « Lancer en Répétition », « Modifier le
 * plan… ». The two cards are one section: aparté's renderer is wrapped, not
 * replaced (`overrideToolRenderer` stacks) — aparté's card has no place for
 * them (apartejs/aparte#222).
 */

import type { PlayMode } from '@aparte/bonaparte-shared';
import { aparteGlobalConfig, type AparteConfig, type AparteToolCallSegment, type AparteToolRenderer } from '@aparte/core';
import { setupPlanCard } from '@aparte/plugin-cards/plan';
import type { Messages } from '../i18n/index';

export type LaunchMode = 'plume' | 'repetition';
export type FileChange = 'new' | 'modified' | 'deleted';

export interface PlanExtras {
  files: { path: string; change: FileChange }[];
  questions: string[];
}

export interface PlanCardHooks {
  /** The mode the conversation runs in now. */
  mode(): PlayMode;
  /** The person launched the plan: the conversation goes to this mode, and the model gets the go-ahead. */
  launch(mode: LaunchMode): void;
  /** The person wants to adjust the plan: the composer is theirs. */
  adjust(): void;
}

const CHANGES: readonly FileChange[] = ['new', 'modified', 'deleted'];
const SIGNS: Record<FileChange, string> = { new: '+', modified: '~', deleted: '−' };

/** What the card shows under the steps, from the call's result (the core keeps only what it can read). */
export function planExtras(segment: AparteToolCallSegment): PlanExtras {
  const result = segment.status === 'resolved' ? segment.structuredResult : undefined;
  if (typeof result !== 'object' || result === null) return { files: [], questions: [] };
  const raw = result as { files?: unknown; questions?: unknown };
  const files = Array.isArray(raw.files)
    ? raw.files.filter(
        (file): file is { path: string; change: FileChange } =>
          typeof file === 'object' && file !== null && typeof file.path === 'string' && CHANGES.includes(file.change),
      )
    : [];
  const questions = Array.isArray(raw.questions) ? raw.questions.filter((question): question is string => typeof question === 'string') : [];
  return { files, questions };
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Sets up the plan cards; `refresh` redraws their actions when the mode moves, `stop` takes everything back. */
export function setupPlanCards(
  messages: Messages,
  hooks: PlanCardHooks,
  config: AparteConfig = aparteGlobalConfig,
): { refresh(): void; stop(): void } {
  const words = messages.plan;
  const stopCard = setupPlanCard({ tool: 'update_plan', config });
  const inner = config.getToolRenderer('update_plan');
  // The plans launched in this window, by call: their card says so instead of offering it again.
  const launched = new Map<string, LaunchMode>();
  const drawn = new Map<HTMLElement, AparteToolCallSegment>();

  const actions = (segment: AparteToolCallSegment): HTMLElement | null => {
    const id = segment.toolCall.id;
    const done = launched.get(id);
    if (done) {
      const row = element('p', 'plan-card__launched');
      row.append(element('span', 'plan-card__launched-label', words.launched(messages.modes[done])), ` ${words.modeNote[done]}`);
      return row;
    }
    if (segment.status !== 'resolved' || hooks.mode() !== 'lecture') return null;
    const row = element('div', 'plan-card__actions');
    const launch = (mode: LaunchMode, label: string, primary: boolean): HTMLButtonElement => {
      const button = element(
        'button',
        `aparte-btn aparte-btn--sm ${primary ? 'aparte-btn--primary aparte-btn--solid' : 'aparte-btn--surface'}`,
        label,
      );
      button.type = 'button';
      button.addEventListener('click', () => {
        launched.set(id, mode);
        refresh();
        hooks.launch(mode);
      });
      return button;
    };
    const adjust = element('button', 'aparte-btn aparte-btn--sm aparte-btn--surface', words.adjust);
    adjust.type = 'button';
    adjust.addEventListener('click', () => hooks.adjust());
    row.append(
      launch('plume', words.launchPlume, true),
      launch('repetition', words.launchRepetition, false),
      adjust,
      element('span', 'plan-card__hint', words.adjustHint),
    );
    return row;
  };

  const fill = (extras: HTMLElement, segment: AparteToolCallSegment): void => {
    const { files, questions } = planExtras(segment);
    const parts: HTMLElement[] = [];
    if (files.length > 0) {
      const list = element('ul', 'plan-card__files');
      list.setAttribute('aria-label', words.files);
      for (const file of files) {
        const item = element('li', 'plan-card__file');
        item.dataset['change'] = file.change;
        item.append(
          element('span', 'plan-card__sign', SIGNS[file.change]),
          element('code', 'plan-card__path', file.path),
          element('span', 'plan-card__change', words.changes[file.change]),
        );
        list.append(item);
      }
      parts.push(list);
    }
    if (questions.length > 0) parts.push(element('p', 'plan-card__questions', `${words.toSettle}${questions.join(' ')}`));
    const row = actions(segment);
    if (row) parts.push(row);
    extras.replaceChildren(...parts);
  };

  function refresh(): void {
    for (const [wrapper, segment] of drawn) {
      if (!wrapper.isConnected) {
        drawn.delete(wrapper);
        continue;
      }
      const extras = wrapper.querySelector<HTMLElement>(':scope > .plan-card__extras');
      if (extras) fill(extras, segment);
    }
  }

  const cardOf = (wrapper: HTMLElement): HTMLElement => wrapper.firstElementChild as HTMLElement;
  const renderer: AparteToolRenderer = {
    ...inner,
    render(segment) {
      const wrapper = element('section', 'plan-card');
      wrapper.setAttribute('aria-label', words.region);
      const card = inner ? inner.render(segment) : '';
      if (typeof card === 'string') {
        const holder = element('div', 'plan-card__steps');
        holder.textContent = card;
        wrapper.append(holder);
      } else {
        wrapper.append(card);
      }
      const extras = element('div', 'plan-card__extras');
      wrapper.append(extras);
      fill(extras, segment);
      drawn.set(wrapper, segment);
      return wrapper;
    },
    setup(wrapper, segment) {
      inner?.setup?.(cardOf(wrapper), segment);
    },
    update(wrapper, segment) {
      if (inner?.update) inner.update(cardOf(wrapper), segment);
      else if (inner) {
        const next = inner.render(segment);
        if (typeof next !== 'string') cardOf(wrapper).replaceWith(next);
      }
      drawn.set(wrapper, segment);
      const extras = wrapper.querySelector<HTMLElement>(':scope > .plan-card__extras');
      if (extras) fill(extras, segment);
    },
    relabel(wrapper, segment) {
      inner?.relabel?.(cardOf(wrapper), segment);
    },
  };
  const restore = config.overrideToolRenderer('update_plan', renderer);

  return {
    refresh,
    stop() {
      restore();
      stopCard();
      drawn.clear();
    },
  };
}
