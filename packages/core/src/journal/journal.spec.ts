/**
 * The journal of a conversation is the truth: what is appended is read back
 * in order after a restart, the prompt it froze is the same text to the
 * byte without rendering anything again, a branch shares the start and
 * leaves the other alone, and a power cut in the middle of a line loses that
 * line only.
 */

import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { frozenPrompt, openJournal } from './journal.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-journal-'));
  dirs.push(dir);
  return dir;
}

const SYSTEM = '<|turn>system\nYou are bonaparte.<turn|>\n';
const USER = '<|turn>user\nBonjour<turn|>\n';
const ANSWER = '<|turn>model\nBonjour Paul.<turn|>\n';

describe('openJournal', () => {
  it('reads back what was appended, in order, after a restart', async () => {
    const dir = await folder();
    const journal = await openJournal(dir, 'c1');
    expect(journal.branchId).toBe('main');
    const system = await journal.append({ kind: 'system', rendered: SYSTEM });
    await journal.append({ kind: 'user', text: 'Bonjour', rendered: USER, messageId: 'm1' });
    await journal.append({ kind: 'assistant', raw: 'Bonjour Paul.', rendered: ANSWER, messageId: 'm2' });
    expect(system.id).toMatch(/\w/);
    expect(system.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const again = await openJournal(dir, 'c1');
    expect(again.entries().map((entry) => entry.kind)).toEqual(['system', 'user', 'assistant']);
    expect(again.entries()).toEqual(journal.entries());
  });

  it("gives the branch's frozen prompt to the byte, from what was written — nothing is rendered again", async () => {
    const dir = await folder();
    const journal = await openJournal(dir, 'c1');
    await journal.append({ kind: 'system', rendered: SYSTEM });
    await journal.append({ kind: 'user', text: 'Bonjour', rendered: USER });
    await journal.append({ kind: 'engine', engineId: 'builtin', modelId: 'gemma' });
    await journal.append({ kind: 'assistant', raw: 'Bonjour Paul.', rendered: ANSWER });
    const reopened = await openJournal(dir, 'c1');
    expect(frozenPrompt(reopened.entries())).toBe(SYSTEM + USER + ANSWER);
  });

  it('starts the frozen prompt at the last rebase', async () => {
    const dir = await folder();
    const journal = await openJournal(dir, 'c1');
    await journal.append({ kind: 'system', rendered: SYSTEM });
    await journal.append({ kind: 'user', text: 'Bonjour', rendered: USER });
    const rebased = '<|turn>system\nYou are bonaparte. Summary: a greeting.<turn|>\n';
    await journal.append({ kind: 'rebase', summary: 'a greeting', rendered: rebased });
    await journal.append({ kind: 'user', text: 'Et ensuite ?', rendered: '<|turn>user\nEt ensuite ?<turn|>\n' });
    expect(frozenPrompt(journal.entries())).toBe(`${rebased}<|turn>user\nEt ensuite ?<turn|>\n`);
  });

  it('forks a branch that shares the start and diverges, leaving the other branch as it was', async () => {
    const dir = await folder();
    const main = await openJournal(dir, 'c1');
    await main.append({ kind: 'system', rendered: SYSTEM });
    const question = await main.append({ kind: 'user', text: 'Bonjour', rendered: USER });
    await main.append({ kind: 'assistant', raw: 'Bonjour Paul.', rendered: ANSWER });

    const branch = await main.fork(question.id);
    expect(branch.branchId).not.toBe('main');
    await branch.append({ kind: 'assistant', raw: 'Salut.', rendered: '<|turn>model\nSalut.<turn|>\n' });

    expect(frozenPrompt(branch.entries())).toBe(`${SYSTEM}${USER}<|turn>model\nSalut.<turn|>\n`);
    expect(frozenPrompt((await openJournal(dir, 'c1')).entries())).toBe(SYSTEM + USER + ANSWER);
    const reopened = await openJournal(dir, 'c1', branch.branchId);
    expect(reopened.entries().map((entry) => entry.kind)).toEqual(['system', 'user', 'assistant']);
    expect(await main.branches()).toEqual([
      expect.objectContaining({ branchId: 'main', forkedAfter: null, from: null }),
      expect.objectContaining({ branchId: branch.branchId, forkedAfter: question.id, from: 'main' }),
    ]);
  });

  it('refuses to fork after an entry the branch does not have', async () => {
    const journal = await openJournal(await folder(), 'c1');
    await expect(journal.fork('nowhere')).rejects.toThrow(/no entry/);
  });

  it('a line cut by a power failure is lost alone, and the journal goes on after it', async () => {
    const dir = await folder();
    const journal = await openJournal(dir, 'c1');
    await journal.append({ kind: 'system', rendered: SYSTEM });
    await journal.append({ kind: 'user', text: 'Bonjour', rendered: USER });
    await appendFile(join(dir, 'c1', 'main.jsonl'), '{"id":"x","at":"2026-11-14T00:00:00Z","kind":"assis');

    const reopened = await openJournal(dir, 'c1');
    expect(reopened.entries().map((entry) => entry.kind)).toEqual(['system', 'user']);
    await reopened.append({ kind: 'assistant', raw: 'Bonjour Paul.', rendered: ANSWER });
    expect((await openJournal(dir, 'c1')).entries().map((entry) => entry.kind)).toEqual(['system', 'user', 'assistant']);
  });

  it('takes back a message the server refused: gone from the entries and from the prompt, kept in the file', async () => {
    const dir = await folder();
    const journal = await openJournal(dir, 'c1');
    await journal.append({ kind: 'system', rendered: SYSTEM });
    const refused = await journal.append({ kind: 'user', text: 'x'.repeat(10), rendered: '<|turn>user\nxxxxxxxxxx<turn|>\n' });
    await journal.append({ kind: 'withdrawn', entryId: refused.id });
    expect(journal.entries().map((entry) => entry.kind)).toEqual(['system']);
    expect(frozenPrompt(journal.entries())).toBe(SYSTEM);
    expect(await readFile(join(dir, 'c1', 'main.jsonl'), 'utf8')).toContain('withdrawn');
  });

  it('two writes at the same time are two whole lines, in the order they were asked', async () => {
    const dir = await folder();
    const one = await openJournal(dir, 'c1');
    const other = await openJournal(dir, 'c1');
    await Promise.all(
      Array.from({ length: 40 }, (_, n) =>
        (n % 2 ? one : other).append({ kind: 'user', text: `message ${n}`, rendered: `${'y'.repeat(5_000)}${n}` }),
      ),
    );
    const read = (await openJournal(dir, 'c1')).entries();
    expect(read).toHaveLength(40);
    expect(read.map((entry) => (entry.kind === 'user' ? entry.text : ''))).toEqual(
      Array.from({ length: 40 }, (_, n) => `message ${n}`),
    );
  });

  it('refuses a conversation or branch id that would leave its folder', async () => {
    const dir = await folder();
    await expect(openJournal(dir, '../escape')).rejects.toThrow(/conversation id/);
    await expect(openJournal(dir, 'c1', '..\\escape')).rejects.toThrow(/branch id/);
  });
});
