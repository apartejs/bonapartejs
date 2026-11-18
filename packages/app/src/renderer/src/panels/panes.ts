/**
 * Which panes are open beside the conversation (task 6.2). Each icon opens
 * or closes its own pane, and the panes stack in one order. In a narrow
 * window a pane goes over the conversation, one at a time: the last opened.
 */

export const PANES = ['files', 'changes', 'subagents', 'browser', 'terminal'] as const;
export type PaneName = (typeof PANES)[number];

/** The panes open, in the order they were opened (the last opened last). */
export type OpenPanes = readonly PaneName[];

/** Opens or closes a pane; over the conversation (narrow), the pane opened takes the place of the others. */
export function toggle(open: OpenPanes, pane: PaneName, narrow = false): OpenPanes {
  if (open.includes(pane)) return narrow ? [] : open.filter((one) => one !== pane);
  return narrow ? [pane] : [...open, pane];
}

export function close(open: OpenPanes, pane: PaneName): OpenPanes {
  return open.filter((one) => one !== pane);
}

/** Opens a pane, if it is not open yet. */
export function opened(open: OpenPanes, pane: PaneName): OpenPanes {
  return open.includes(pane) ? open : [...open, pane];
}

/** What is shown: beside the conversation, every open pane in their order; over it, the last opened. */
export function shownPanes(open: OpenPanes, narrow: boolean): PaneName[] {
  if (narrow) return open.length > 0 ? [open[open.length - 1]!] : [];
  return PANES.filter((pane) => open.includes(pane));
}

/** « Ouvrir un volet tout seul »: Changements opens by itself when a change waits, unless the person said never. */
export function opensByItself(setting: unknown): boolean {
  return setting !== 'never';
}
