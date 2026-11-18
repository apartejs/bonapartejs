import type { DoctorReport } from '@aparte/bonaparte-core';
import { describe, expect, it } from 'vitest';
import { localeOf, main } from './main.js';
import { formatDoctorReport } from './format.js';
import { en } from './messages/en.js';
import { fr } from './messages/fr.js';

const GiB = 1024 ** 3;

const GOOD: DoctorReport = {
  ok: true,
  checks: [
    { id: 'node', status: 'ok', blocking: false, version: 'v24.14.0', min: 22 },
    { id: 'llama', status: 'ok', blocking: false, found: true, source: 'managed', command: '/data/llama.cpp/b12383/llama-server', build: 'b12383' },
    { id: 'slots', status: 'ok', blocking: false, dir: '/data/kv-slots', writable: true, freeBytes: 500 * GiB },
    { id: 'gpu', status: 'ok', blocking: false, bytes: 24 * GiB },
  ],
};

const BAD: DoctorReport = {
  ok: false,
  checks: [
    { id: 'node', status: 'ok', blocking: false, version: 'v24.14.0', min: 22 },
    { id: 'llama', status: 'fail', blocking: true, found: false },
    { id: 'slots', status: 'warn', blocking: false, dir: '/data/kv-slots', writable: true, freeBytes: 1.5 * GiB },
    { id: 'gpu', status: 'warn', blocking: false, bytes: null },
  ],
};

function output() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) } };
}

describe('the messages', () => {
  it('have the same keys in French and in English', () => {
    const keys = (value: object, at = ''): string[] =>
      Object.entries(value).flatMap(([key, inner]) =>
        inner && typeof inner === 'object' ? keys(inner as object, `${at}${key}.`) : [`${at}${key}`],
      );
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });
});

describe('formatDoctorReport', () => {
  it('one line per check, its mark first, and the verdict at the end', () => {
    expect(formatDoctorReport(GOOD, fr).split('\n')).toEqual([
      "('.') bonaparte doctor",
      '',
      ' ✓ Node v24.14.0',
      ' ✓ llama.cpp b12383, installé par bonaparte (/data/llama.cpp/b12383/llama-server)',
      ' ✓ Mémoires des conversations : /data/kv-slots · 500 Go libres',
      ' ✓ Carte graphique : 24 Go de mémoire vidéo',
      '',
      'Tout est prêt pour le moteur intégré.',
    ]);
  });

  it('says what blocks, what only warns, in English too', () => {
    const lines = formatDoctorReport(BAD, en).split('\n');
    expect(lines[3]).toMatch(/^ ✗ llama\.cpp not found/);
    expect(lines[4]).toBe(' ! Conversation memories: /data/kv-slots · only 1.5 GB free');
    expect(lines[5]).toMatch(/^ ! No graphics card measured/);
    expect(lines.at(-1)).toBe('The built-in engine cannot run until what is marked ✗ is fixed.');
  });

  it('colours the marks only on a terminal', () => {
    expect(formatDoctorReport(GOOD, fr)).not.toContain('\u001b[');
    expect(formatDoctorReport(GOOD, fr, { color: true })).toContain('\u001b[32m✓\u001b[0m');
  });
});

describe('the command', () => {
  it('« doctor » prints the report and exits 0 when nothing blocks, 1 otherwise', async () => {
    const good = output();
    expect(await main(['doctor'], { ...good.io, locale: 'fr', version: '0.1.0', doctor: async () => GOOD })).toBe(0);
    expect(good.out.join('\n')).toContain('Tout est prêt pour le moteur intégré.');
    const bad = output();
    expect(await main(['doctor'], { ...bad.io, locale: 'en', version: '0.1.0', doctor: async () => BAD })).toBe(1);
  });

  it('--version, --help, and nothing else: an unknown command is said, with the help', async () => {
    const version = output();
    expect(await main(['--version'], { ...version.io, locale: 'en', version: '0.1.0', doctor: async () => GOOD })).toBe(0);
    expect(version.out).toEqual(['0.1.0']);
    const help = output();
    expect(await main(['--help'], { ...help.io, locale: 'en', version: '0.1.0', doctor: async () => GOOD })).toBe(0);
    expect(help.out.join('\n')).toContain('bonaparte doctor');
    expect(help.out.join('\n')).toContain('launches the app');
    const unknown = output();
    expect(await main(['fly'], { ...unknown.io, locale: 'fr', version: '0.1.0', doctor: async () => GOOD })).toBe(1);
    expect(unknown.err).toEqual(['Commande inconnue : fly']);
    expect(unknown.out.join('\n')).toContain('Utilisation');
  });

  it('with no argument launches the app (task 13.3)', async () => {
    const io = output();
    let launched = 0;
    const launch = async () => {
      launched += 1;
      return 0;
    };
    expect(await main([], { ...io.io, locale: 'en', version: '0.1.0', doctor: async () => GOOD, launch })).toBe(0);
    expect(launched).toBe(1);
  });

  it('speaks the language of the environment: BONAPARTE_LANG, then LC_ALL, then LANG — English otherwise', () => {
    expect(localeOf({ BONAPARTE_LANG: 'fr' })).toBe('fr');
    expect(localeOf({ LC_ALL: 'fr_FR.UTF-8', LANG: 'en_US.UTF-8' })).toBe('fr');
    expect(localeOf({ LANG: 'en_GB.UTF-8' })).toBe('en');
    expect(localeOf({}, 'de-DE')).toBe('en');
    expect(localeOf({}, 'fr-FR')).toBe('fr');
  });
});
