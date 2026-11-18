/**
 * The window's door to a plugin made in a conversation (task 11.4): its card names the revision it shows, and what
 * the card does — read the code, try it, install it — is done on that very revision, never on a newer one the
 * person has not seen.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCore, type Core } from '../api.js';

const dirs: string[] = [];
const cores: Core[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

const manifest = (version: string, effect: string) => ({
  id: 'changelog',
  name: 'Changelog',
  version,
  effects: [{ effect, what: 'something' }],
  contributes: { commands: [{ name: 'changelog', description: 'Sum up the day' }] },
});
const code = (word: string) => `export default { activate(ctx) { ctx.registerCommand('changelog', () => ({ send: '${word}' })); } };\n`;

describe('a card acts on the revision it shows', () => {
  it('its code, its trial and its install are those of its revision; a revision not there is said', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bp-extensions-api-'));
    dirs.push(dir);
    await mkdir(join(dir, 'home'), { recursive: true });
    const core = createCore({ dataDir: join(dir, 'data'), env: {}, home: join(dir, 'home'), gh: null, logger: () => undefined });
    cores.push(core);
    const ctx = { conversationId: 'c1', roots: [join(dir, 'home')], nCtx: 8192, signal: new AbortController().signal };
    await core.tools.run({ id: 't1', name: 'extension_define', input: { manifest: manifest('0.1.0', 'read'), code: code('first') } }, ctx);
    await core.tools.run({ id: 't2', name: 'extension_define', input: { manifest: manifest('0.2.0', 'network'), code: code('second') } }, ctx);
    expect((await core.extensions.code('c1', 'changelog', 1))?.code).toContain('first');
    expect((await core.extensions.code('c1', 'changelog', 2))?.code).toContain('second');
    expect(await core.extensions.code('c1', 'changelog', 9)).toBeNull();
    await expect(core.extensions.try('c1', 'changelog', 9)).rejects.toThrow(/revision 9/);
    await expect(core.extensions.install('c1', 'changelog', 9)).rejects.toThrow(/revision 9/);
  });
});
