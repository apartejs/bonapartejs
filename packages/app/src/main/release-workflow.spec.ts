/**
 * The workflows that build and publish (review of round 6): the job's token is never left in the checkout's git
 * configuration for every later step — the install scripts of the dependencies included — to read; a run by hand
 * builds what it asks for, Windows too only when asked; and a tag's installers go into a release still a draft,
 * since electron-builder skips a published one in silence.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = (name: string): string => readFileSync(new URL(`../../../../.github/workflows/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('the workflows', () => {
  it('never keep the token in the checkout', () => {
    for (const name of ['ci.yml', 'release.yml']) {
      const text = workflow(name);
      const checkouts = [...text.matchAll(/^( *)- uses: actions\/checkout@.*\n((?:\1  .*\n)*)/gm)];
      expect(checkouts.length, name).toBeGreaterThan(0);
      for (const [, , body] of checkouts) expect(body, name).toMatch(/^\s+persist-credentials: false$/m);
    }
  });

  it('a run by hand builds the systems it checks — Windows only when checked; a tag, Windows', () => {
    const text = workflow('release.yml');
    expect(text).toMatch(/^ {6}windows:\n {8}description: .*\n {8}type: boolean\n {8}default: true$/m);
    // Windows is not always in the list: it can be left out of a run by hand.
    expect(text).not.toMatch(/format\('\["windows-2025-vs2026"/);
    expect(text).toMatch(/- os: \$\{\{ github\.event_name == 'workflow_dispatch' && !inputs\.windows && 'windows-2025-vs2026' \|\| 'none' \}\}/);
    expect(text).toMatch(/- os: \$\{\{ !inputs\.macos && 'macos-latest' \|\| 'none' \}\}/);
    expect(text).toMatch(/- os: \$\{\{ !inputs\.linux && 'ubuntu-latest' \|\| 'none' \}\}/);
  });

  it('a tag publishes into a draft only, checked before anything is built', () => {
    const text = workflow('release.yml');
    const check = text.indexOf('- name: Check the release is still a draft');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(text.indexOf('- name: Install dependencies'));
    expect(text.slice(check, text.indexOf('- name:', check + 1))).toMatch(/isDraft/);
  });
});
