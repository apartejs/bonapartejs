/**
 * The notification area's menu (task 5.9; the rest of it comes with 8.5):
 * « Ouvrir bonaparte » brings the window back, « Quitter » quits.
 */

import { describe, expect, it } from 'vitest';
import { mainWords } from './i18n/index.js';
import { trayMenu } from './tray.js';

describe('the tray menu', () => {
  it('opens the window and quits, in the language of the interface', () => {
    const done: string[] = [];
    const menu = trayMenu(mainWords('fr').tray, { open: () => done.push('open'), quit: () => done.push('quit') });
    const labelled = menu.filter((item) => item.label);
    expect(labelled.map((item) => item.label)).toEqual(['Ouvrir bonaparte', 'Quitter']);
    for (const item of labelled) item.click?.(undefined as never, undefined, undefined as never);
    expect(done).toEqual(['open', 'quit']);
  });
});
