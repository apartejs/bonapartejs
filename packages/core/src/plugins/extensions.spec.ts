/**
 * A plugin made in a conversation (task 11.4): each definition is a revision of its own, under
 * `<data>/extensions/<conversation>/<id>/<rev>/`, never written again; its code is compiled without being run, and
 * a code that does not compile is refused with what to fix — said to the model, in English.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtensionStore } from './extensions.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function store() {
  const data = await mkdtemp(join(tmpdir(), 'bp-extensions-'));
  dirs.push(data);
  return { data, extensions: new ExtensionStore({ dataDir: data, env: () => ({ ...process.env }) as Record<string, string> }) };
}

const MANIFEST = {
  id: 'changelog',
  name: { en: 'Changelog', fr: 'Changelog' },
  version: '0.1.0',
  effects: [{ effect: 'execute', what: { en: 'run git log', fr: 'lancer git log' } }],
  contributes: { commands: [{ name: 'changelog', description: { en: 'Sum up the commits of the day', fr: 'Résumer les commits du jour' } }] },
};
const CODE = "export default { activate(ctx) { ctx.registerCommand('changelog', () => ({ send: 'Résume les commits du jour.' })); } };\n";

describe('a plugin made in a conversation (task 11.4)', () => {
  it('each definition is a revision of its own, its code compiled, never written again', async () => {
    const { data, extensions } = await store();
    const first = await extensions.define('c1', { manifest: MANIFEST, code: CODE });
    expect(first).toMatchObject({ ok: true, extension: { id: 'changelog', rev: 1, lines: 1 } });
    const second = await extensions.define('c1', { manifest: { ...MANIFEST, version: '0.1.1' }, code: CODE });
    expect(second).toMatchObject({ ok: true, extension: { id: 'changelog', rev: 2 } });
    const dir1 = join(data, 'extensions', 'c1', 'changelog', '1');
    expect(JSON.parse(await readFile(join(dir1, 'plugin.json'), 'utf8'))).toMatchObject({ version: '0.1.0', entry: { node: 'index.mjs' } });
    expect(await readFile(join(dir1, 'index.mjs'), 'utf8')).toBe(CODE);
    expect(extensions.latest('c1')).toMatchObject([{ id: 'changelog', rev: 2 }]);
  });

  it('a code that does not compile is refused, with what to fix; nothing of it is kept', async () => {
    const { data, extensions } = await store();
    const refused = await extensions.define('c1', { manifest: MANIFEST, code: 'export default { activate(ctx) { ctx.registerCommand( } };' });
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/does not compile[\s\S]*SyntaxError/) });
    expect(existsSync(join(data, 'extensions', 'c1', 'changelog', '1'))).toBe(false);
  });

  it('a manifest that does not read is refused with where', async () => {
    const { extensions } = await store();
    expect(await extensions.define('c1', { manifest: { ...MANIFEST, effects: [] , contributes: { tools: [{ name: 'x', description: 'x', effect: 'write' }] } }, code: CODE })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/contributes\.tools\.0\.effect/),
    });
    expect(await extensions.define('c1', { manifest: { ...MANIFEST, id: '../evil' }, code: CODE })).toMatchObject({ ok: false });
  });

  it('undefined, all its revisions go', async () => {
    const { data, extensions } = await store();
    await extensions.define('c1', { manifest: MANIFEST, code: CODE });
    await extensions.undefine('c1', 'changelog');
    expect(existsSync(join(data, 'extensions', 'c1', 'changelog'))).toBe(false);
    expect(extensions.latest('c1')).toEqual([]);
  });
});
