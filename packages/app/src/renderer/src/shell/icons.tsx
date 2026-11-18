/**
 * The glyphs of the shell: aparté's own set (`@aparte/core/icons`). A glyph
 * of the app's own domain (git's, later) is drawn in its stroke — a 24
 * viewBox, the `aparte-icon` class, `currentColor`.
 */

import {
  botIcon,
  chevronLeftIcon,
  codeIcon,
  eyeIcon,
  globeIcon,
  imageIcon,
  retryIcon,
  chevronDownIcon,
  chevronRightIcon,
  chevronUpIcon,
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

/** « À traiter »: a tray, the app's own, drawn in the kit's stroke. */
const inboxIcon = `<svg ${STROKE}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`;

const ICONS = {
  branch: branchIcon,
  inbox: inboxIcon,
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
  subagents: botIcon,
  globe: globeIcon,
  back: chevronLeftIcon,
  reload: retryIcon,
  eye: eyeIcon,
  pick: codeIcon,
  screenshot: imageIcon,
  comment: messageSquareIcon,
  chevronUp: chevronUpIcon,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  // Constant SVG of aparté's set: nothing a person or a model wrote.
  return <span className="bonaparte-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
