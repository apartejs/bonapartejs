/**
 * What `bonaparte-plugin://<id>/` serves (task 11.2): the files of a plugin's view, from its own folder only — a
 * revision on trial under `@<rev>/` —, the kit's stylesheet under `@bonaparte/kit.css`, and every answer with a
 * strict Content-Security-Policy: its own scripts and styles, no connection anywhere, framed by the app only.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { servePluginFile } from './protocol.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function rig() {
  const root = await mkdtemp(join(tmpdir(), 'bp-plugin-proto-'));
  dirs.push(root);
  await mkdir(join(root, 'notes', 'ui'), { recursive: true });
  await writeFile(join(root, 'notes', 'view.html'), '<!doctype html><title>Notes</title>');
  await writeFile(join(root, 'notes', 'ui', 'view.js'), 'export {};');
  await writeFile(join(root, 'secret.js'), 'not of the plugin');
  await mkdir(join(root, 'trial', '2'), { recursive: true });
  await writeFile(join(root, 'trial', '2', 'view.html'), '<!doctype html><title>Essai</title>');
  const deps = {
    dirOf: (id: string, rev?: string) => (id === 'notes' && !rev ? join(root, 'notes') : id === 'changelog' && rev === '2' ? join(root, 'trial', '2') : null),
    kitCss: ':root { --aparte-primary: #087EA4; }',
  };
  return { root, deps };
}

describe('bonaparte-plugin:// (task 11.2)', () => {
  it('serves a plugin’s own files, each with its type and the strict policy', async () => {
    const { deps } = await rig();
    const page = await servePluginFile('bonaparte-plugin://notes/view.html', deps);
    expect(page.status).toBe(200);
    expect(page.headers['Content-Type']).toBe('text/html; charset=utf-8');
    const csp = page.headers['Content-Security-Policy']!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('script-src bonaparte-plugin://notes');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('frame-ancestors bonaparte://app');
    const script = await servePluginFile('bonaparte-plugin://notes/ui/view.js', deps);
    expect(script).toMatchObject({ status: 200, headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
  });

  it('never a file outside its folder, nor another plugin’s, nor a plugin it does not know', async () => {
    const { deps } = await rig();
    expect((await servePluginFile('bonaparte-plugin://notes/../secret.js', deps)).status).toBe(404);
    expect((await servePluginFile('bonaparte-plugin://notes/%2e%2e/secret.js', deps)).status).toBe(404);
    expect((await servePluginFile('bonaparte-plugin://notes/..%5Csecret.js', deps)).status).toBe(404);
    expect((await servePluginFile('bonaparte-plugin://stranger/view.html', deps)).status).toBe(404);
    expect((await servePluginFile('bonaparte-plugin://notes/missing.html', deps)).status).toBe(404);
  });

  it('a revision on trial under @<rev>/, and the kit’s stylesheet for every view', async () => {
    const { deps } = await rig();
    const trial = await servePluginFile('bonaparte-plugin://changelog/@2/view.html', deps);
    expect(trial.status).toBe(200);
    expect(new TextDecoder().decode(trial.body)).toContain('Essai');
    expect(trial.headers['Content-Security-Policy']).toContain('script-src bonaparte-plugin://changelog/@2/');
    const kit = await servePluginFile('bonaparte-plugin://notes/@bonaparte/kit.css', deps);
    expect(kit).toMatchObject({ status: 200, headers: { 'Content-Type': 'text/css; charset=utf-8' } });
    expect(new TextDecoder().decode(kit.body)).toContain('--aparte-primary');
  });
});
