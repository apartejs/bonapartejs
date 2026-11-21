/**
 * What « Toujours autoriser » remembers, in the person's words (audit
 * 2026-11-21, D3): on the card, what « Pour cette conversation » and
 * « Toujours » would keep; in the settings, what each rule kept lets pass.
 * A rule is the core's: the window only says it.
 */

import type { AllowRuleView } from '@aparte/bonaparte-shared';
import type { Messages } from '../i18n/index';

/** A command as the card shows it: the program and its arguments, quoted when they hold a space. */
export function commandText(program: string, args: readonly string[]): string {
  return [program, ...args].map((part) => (part === '' || /\s/.test(part) ? JSON.stringify(part) : part)).join(' ');
}

/** What a folder rule names: `src/` for `src/**`. */
function folderOf(path: string): string {
  return path.endsWith('/**') ? `${path.slice(0, -2)}` : path;
}

/** Under the card's buttons: what is remembered, and its subject. */
export function rememberedOnCard(rule: AllowRuleView, messages: Messages): { lead: string; subject: string } {
  const what = messages.approval.remember.what;
  if (rule.program !== undefined) return { lead: what.command, subject: commandText(rule.program, rule.args ?? []) };
  if (rule.path !== undefined) return rule.path.endsWith('/**') ? { lead: what.folder, subject: folderOf(rule.path) } : { lead: what.file, subject: rule.path };
  if (rule.origin !== undefined) return { lead: what.site, subject: rule.origin };
  return { lead: what.tool, subject: rule.tool };
}

/** In the settings: what a rule lets pass without asking — its verb, its subject, and what follows a folder. */
export function rememberedInSettings(rule: AllowRuleView, messages: Messages): { lead: string; subject: string; tail?: string } {
  const lets = messages.settings.permissions.remembered.lets;
  if (rule.program !== undefined) return { lead: lets.command, subject: commandText(rule.program, rule.args ?? []) };
  if (rule.path !== undefined) {
    const lead = rule.tool === 'write_file' ? lets.write : lets.edit;
    return rule.path.endsWith('/**')
      ? { lead, subject: folderOf(rule.path), tail: messages.settings.permissions.remembered.folder }
      : { lead, subject: rule.path };
  }
  if (rule.origin !== undefined) {
    const lead = rule.tool === 'browser_act' ? lets.act : rule.tool === 'browser_open' ? lets.open : rule.tool === 'web_fetch' ? lets.fetch : null;
    return lead ? { lead, subject: rule.origin } : { lead: lets.tool, subject: `${rule.tool} ${rule.origin}` };
  }
  return { lead: lets.tool, subject: rule.tool };
}
