/**
 * Windows shows a banner only for the app its Start-menu shortcut names: the installed app says the id the installer
 * gave that shortcut (review of phase 13).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_ID } from './app-id.js';

describe('the app’s id', () => {
  it('is the installer’s appId', () => {
    const config = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8');
    expect(config).toMatch(new RegExp(`^appId: ${APP_ID.replace(/\./g, '\\.')}$`, 'm'));
  });
});
