/**
 * The mode switch of the composer's toolbar: aparté's `<aparte-approval-mode>`,
 * with bonaparte's four names. The core keeps the mode and decides every
 * call; the switch only tells it the person's choice. aparté's element is
 * enabled by `setupApproval`, whose page policy is never consulted here:
 * the window's approval resolver owns every decision.
 *
 * aparté's modes ↔ bonaparte's: plan ↔ Lecture, ask ↔ Répétition,
 * auto-edit ↔ Plume, auto ↔ Impro. No React wrapper: the element is made as
 * it is (apartejs/aparte#216).
 */

import { aparteGlobalConfig } from '@aparte/core';
import { getApprovalController, setupApproval, type ApprovalMode } from '@aparte/plugin-approval';
import type { PlayMode } from '@aparte/bonaparte-shared';
import { createElement, useEffect, useMemo, useRef } from 'react';
import type { Messages } from '../i18n/index';

const TO_APARTE: Record<PlayMode, ApprovalMode> = { lecture: 'plan', repetition: 'ask', plume: 'auto-edit', impro: 'auto' };
const FROM_APARTE: Record<ApprovalMode, PlayMode> = { plan: 'lecture', ask: 'repetition', 'auto-edit': 'plume', auto: 'impro' };

/** What the element needs to enable itself; the classification is never read (the resolver decides). */
const CLASSIFY = {
  read: ['read_file', 'list_files', 'search'],
  write: ['edit_file', 'write_file'],
  exec: ['run_command', 'web_fetch'],
};

export interface ModeSwitchProps {
  mode: PlayMode;
  messages: Messages;
  onChange(mode: PlayMode): void;
}

export function ModeSwitch({ mode, messages, onChange }: ModeSwitchProps) {
  const element = useRef<HTMLElement & { labels: Partial<Record<ApprovalMode, string>> }>(null);
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);

  const controller = useMemo(
    () => getApprovalController(aparteGlobalConfig) ?? setupApproval({ classify: CLASSIFY, mode: TO_APARTE[mode], commands: false }, aparteGlobalConfig),
    // One controller for the window, made once: the mode it shows follows the conversation below.
    [],
  );

  useEffect(() => {
    if (element.current) {
      const names = messages.modes;
      element.current.labels = { plan: names.lecture, ask: names.repetition, 'auto-edit': names.plume, auto: names.impro };
    }
  }, [messages]);

  // The conversation's mode, shown; set this way, the element says nothing back.
  useEffect(() => {
    if (controller.getMode() !== TO_APARTE[mode]) controller.setMode(TO_APARTE[mode]);
  }, [controller, mode]);

  // The person's choice.
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const listener = (event: Event): void => {
      const next = (event as CustomEvent<{ mode: ApprovalMode }>).detail.mode;
      changed.current(FROM_APARTE[next]);
    };
    node.addEventListener('aparte-approval-mode-change', listener);
    return () => node.removeEventListener('aparte-approval-mode-change', listener);
  }, []);

  return createElement('aparte-approval-mode', { ref: element, className: 'mode-switch' });
}
