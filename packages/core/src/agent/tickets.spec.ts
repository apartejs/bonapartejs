/**
 * The ticket of a paused turn: what the page brings back to resume it. Signed
 * with a secret of this installation (HMAC-SHA256), for one message and its
 * calls, for seven days. A ticket changed, or one of another message or of
 * other calls, or too old, resumes nothing — and the secret outlives a
 * restart, so a turn paused yesterday resumes today.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTickets, installationSecret, TICKET_MAX_AGE_MS } from './tickets.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bp-tickets-'));
  dirs.push(dir);
  return dir;
}

const CLAIMS = { messageId: 'm1', calls: ['call-1', 'call-2'] };

describe('tickets', () => {
  it('a ticket signed for a message and its calls is good for them', async () => {
    const tickets = createTickets(await installationSecret(await folder()));
    const ticket = tickets.signTicket(CLAIMS);
    expect(tickets.verifyTicket(ticket, CLAIMS)).toMatchObject({ ok: true });
  });

  it('refuses a ticket changed, one of another message, one of other calls', async () => {
    const tickets = createTickets(await installationSecret(await folder()));
    const ticket = tickets.signTicket(CLAIMS);
    const [payload, signature] = ticket.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), calls: ['call-9'] })).toString('base64url')}.${signature}`;
    expect(tickets.verifyTicket(forged, { ...CLAIMS, calls: ['call-9'] })).toEqual({ ok: false, reason: 'signature' });
    expect(tickets.verifyTicket(ticket, { ...CLAIMS, messageId: 'm2' })).toEqual({ ok: false, reason: 'other-message' });
    expect(tickets.verifyTicket(ticket, { ...CLAIMS, calls: ['call-1'] })).toEqual({ ok: false, reason: 'other-calls' });
    expect(tickets.verifyTicket('not a ticket', CLAIMS)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a ticket older than seven days', async () => {
    let now = Date.parse('2026-11-15T00:00:00Z');
    const tickets = createTickets(await installationSecret(await folder()), { now: () => now });
    const ticket = tickets.signTicket(CLAIMS);
    now += TICKET_MAX_AGE_MS - 1;
    expect(tickets.verifyTicket(ticket, CLAIMS)).toMatchObject({ ok: true });
    now += 2;
    expect(tickets.verifyTicket(ticket, CLAIMS)).toEqual({ ok: false, reason: 'expired' });
  });

  it("refuses another installation's ticket", async () => {
    const one = createTickets(await installationSecret(await folder()));
    const two = createTickets(await installationSecret(await folder()));
    expect(two.verifyTicket(one.signTicket(CLAIMS), CLAIMS)).toEqual({ ok: false, reason: 'signature' });
  });

  it('the secret is made once and outlives a restart: a ticket of yesterday is good today', async () => {
    const dir = await folder();
    const before = createTickets(await installationSecret(dir));
    const ticket = before.signTicket(CLAIMS);
    const after = createTickets(await installationSecret(dir));
    expect(after.verifyTicket(ticket, CLAIMS)).toMatchObject({ ok: true });
  });

  it('every ticket has an id of its own', async () => {
    const tickets = createTickets(await installationSecret(await folder()));
    const one = tickets.verifyTicket(tickets.signTicket(CLAIMS), CLAIMS);
    const two = tickets.verifyTicket(tickets.signTicket(CLAIMS), CLAIMS);
    expect(one.ok && two.ok && one.id !== two.id).toBe(true);
  });
});
