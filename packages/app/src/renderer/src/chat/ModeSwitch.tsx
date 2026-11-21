/**
 * The mode switch of the composer's toolbar: aparté's `<aparte-approval-mode>`,
 * with bonaparte's four names. The core keeps the mode and decides every
 * call; the switch only tells it the person's choice. aparté's element is
 * enabled by `setupApproval`, whose page policy is never consulted here:
 * the window's approval resolver owns every decision.
 *
 * aparté's modes ↔ bonaparte's: plan ↔ Lecture, ask ↔ Répétition,
 * auto-edit ↔ Plume, auto ↔ Impro. The element comes through React as a
 * component made from its spec (`createAparteElement`, aparté 1.10).
 */

import { aparteGlobalConfig } from '@aparte/core';
import { approvalModeElement, getApprovalController, setupApproval, type ApprovalMode } from '@aparte/plugin-approval';
import { createAparteElement } from '@aparte/react';
import type { PlayMode } from '@aparte/bonaparte-shared';
import { useEffect, useMemo, useRef } from 'react';
import type { Messages } from '../i18n/index';

const ApprovalModeSwitch = createAparteElement(approvalModeElement);

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
  const controller = useMemo(
    () => getApprovalController(aparteGlobalConfig) ?? setupApproval({ classify: CLASSIFY, mode: TO_APARTE[mode], commands: false }, aparteGlobalConfig),
    // One controller for the window, made once: the mode it shows follows the conversation below.
    [],
  );

  const labels = useMemo(() => {
    const names = messages.modes;
    return { plan: names.lecture, ask: names.repetition, 'auto-edit': names.plume, auto: names.impro };
  }, [messages]);

  // The conversation's mode, shown; set this way, the element says nothing back.
  useEffect(() => {
    if (controller.getMode() !== TO_APARTE[mode]) controller.setMode(TO_APARTE[mode]);
  }, [controller, mode]);

  // The person's choice — and only theirs. aparté's select says « change » when its value is set by code too, and
  // the mode element turns that into a mode change: an update that came late, the mode of the conversation just
  // left, became the next conversation's (GitHub's runner, 2026-11-21). A choice is made with the list open or a
  // key typed in the switch; anything else is an echo, never told to the core (apartejs/aparte#295).
  const host = useRef<HTMLSpanElement>(null);
  const touched = useRef(0);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let opened = false;
    const open = (): void => {
      opened = true;
      touched.current = Number.POSITIVE_INFINITY;
    };
    // A close counts only after an open: a value set by code closes the list too.
    const closed = (): void => {
      if (!opened) return;
      opened = false;
      touched.current = performance.now();
    };
    const typed = (): void => {
      touched.current = Math.max(touched.current, performance.now());
    };
    element.addEventListener('aparte-select-open', open);
    element.addEventListener('aparte-select-close', closed);
    element.addEventListener('keydown', typed, true);
    return () => {
      element.removeEventListener('aparte-select-open', open);
      element.removeEventListener('aparte-select-close', closed);
      element.removeEventListener('keydown', typed, true);
    };
  }, []);
  const choice = (detail: { mode: ApprovalMode }): void => {
    if (performance.now() - touched.current > PERSON_MS) {
      // An echo: the switch goes back to the conversation's mode.
      controller.setMode(TO_APARTE[mode]);
      return;
    }
    onChange(FROM_APARTE[detail.mode]);
  };
  return (
    <span ref={host} className="mode-switch-host">
      <ApprovalModeSwitch className="mode-switch" labels={labels} onApprovalModeChange={choice} />
    </span>
  );
}

/** How long after the list closed, or a key was typed in it, a change is still the person's. */
const PERSON_MS = 250;
