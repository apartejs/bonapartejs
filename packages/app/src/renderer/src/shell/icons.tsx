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

const ICONS = {
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
