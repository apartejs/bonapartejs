/**
 * The glyphs of the shell: aparté's own set (`@aparte/core/icons`). A glyph
 * of the app's own domain (git's, later) is drawn in its stroke — a 24
 * viewBox, the `aparte-icon` class, `currentColor`.
 */

import {
  chevronDownIcon,
  chevronRightIcon,
  closeIcon,
  cpuIcon,
  editIcon,
  fileIcon,
  folderIcon,
  messageSquareIcon,
  moreHorizontalIcon,
  panelLeftIcon,
  plusIcon,
  searchIcon,
  settingsIcon,
  terminalIcon,
} from '@aparte/core/icons';

const STROKE = 'class="aparte-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** A git branch: the app's own domain, drawn in the kit's stroke. */
const branchIcon = `<svg ${STROKE}><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10"/><path d="M18 9a6 6 0 0 1-6 6H8"/></svg>`;

const ICONS = {
  branch: branchIcon,
  panel: panelLeftIcon,
  plus: plusIcon,
  search: searchIcon,
  folder: folderIcon,
  chevronRight: chevronRightIcon,
  chevronDown: chevronDownIcon,
  engine: cpuIcon,
  settings: settingsIcon,
  more: moreHorizontalIcon,
  conversation: messageSquareIcon,
  close: closeIcon,
  file: fileIcon,
  edit: editIcon,
  terminal: terminalIcon,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  // Constant SVG of aparté's set: nothing a person or a model wrote.
  return <span className="bonaparte-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
