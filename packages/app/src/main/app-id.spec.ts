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

  // A per-user installer puts the app under %LOCALAPPDATA%\Programs\<the packed package's name>: without this, the
  // workspace's scoped name made the folder « @apartebonaparte-app » (Windows Sandbox, 2026-11-21).
  it('installs into a folder named bonaparte', () => {
    const config = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8');
    expect(config).toMatch(/^extraMetadata:\n {2}name: bonaparte$/m);
  });
});
