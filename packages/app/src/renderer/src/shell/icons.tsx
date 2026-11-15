/**
 * The glyphs of the shell: aparté's own set (`@aparte/core/icons`), and the
 * few it does not draw yet (apartejs/aparte#231), drawn in its stroke — a
 * 24 viewBox, `currentColor`, a stroke of 2.
 */

import {
  chevronRightIcon,
  cpuIcon,
  folderIcon,
  messageSquareIcon,
  moreHorizontalIcon,
  plusIcon,
  searchIcon,
  settingsIcon,
} from '@aparte/core/icons';

const STROKE = 'class="aparte-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** The sidebar, as a panel: what folds and unfolds it (apartejs/aparte#231). */
const panelIcon = `<svg ${STROKE}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>`;
/** An open group (apartejs/aparte#231). */
const chevronDownIcon = `<svg ${STROKE}><path d="m6 9 6 6 6-6"/></svg>`;

const ICONS = {
  panel: panelIcon,
  plus: plusIcon,
  search: searchIcon,
  folder: folderIcon,
  chevronRight: chevronRightIcon,
  chevronDown: chevronDownIcon,
  engine: cpuIcon,
  settings: settingsIcon,
  more: moreHorizontalIcon,
  conversation: messageSquareIcon,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  // Constant SVG of aparté's set and ours: nothing a person or a model wrote.
  return <span className="bonaparte-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
