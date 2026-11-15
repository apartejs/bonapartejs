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
import { useEffect, useMemo } from 'react';
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

  // The person's choice.
  return <ApprovalModeSwitch className="mode-switch" labels={labels} onApprovalModeChange={(detail) => onChange(FROM_APARTE[detail.mode])} />;
}
