/**
 * The ticket of a paused turn: what the page brings back to resume it.
 * `<payload>.<signature>`, both base64url: the payload names the message,
 * its calls (their ids), the moment it was signed and an id of its own; the
 * signature is HMAC-SHA256 with a secret of this installation, kept in the
 * data folder (made once, outliving restarts). A ticket is good for seven
 * days, for its message and its calls only.
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const TICKET_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface TicketClaims {
  messageId: string;
  /** The ids of the calls the turn paused on, in order. */
  calls: readonly string[];
}

export type TicketCheck =
  | { ok: true; id: string }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'other-message' | 'other-calls' };

interface Payload {
  v: 1;
  id: string;
  messageId: string;
  calls: string[];
  at: number;
}

/** The secret tickets are signed with: 32 random bytes in `<dir>/engine/ticket.key`, made once. */
export async function installationSecret(dataDir: string): Promise<Buffer> {
  const file = join(dataDir, 'engine', 'ticket.key');
  const known = await readFile(file).catch(() => null);
  if (known && known.length >= 32) return known;
  const secret = randomBytes(32);
  await mkdir(dirname(file), { recursive: true });
  // `wx`: two cores starting at once keep one secret, the first.
  await writeFile(file, secret, { flag: 'wx', mode: 0o600 }).catch(() => undefined);
  return readFile(file);
}

export function createTickets(secret: Buffer, options: { now?: () => number } = {}) {
  const now = options.now ?? (() => Date.now());
  const sign = (payload: string): Buffer => createHmac('sha256', secret).update(payload).digest();

  return {
    signTicket(claims: TicketClaims): string {
      const payload: Payload = { v: 1, id: randomUUID(), messageId: claims.messageId, calls: [...claims.calls], at: now() };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${encoded}.${sign(encoded).toString('base64url')}`;
    },

    verifyTicket(ticket: string, claims: TicketClaims): TicketCheck {
      const parts = ticket.split('.');
      if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
      const [encoded, signature] = parts as [string, string];
      const expected = sign(encoded);
      const given = Buffer.from(signature, 'base64url');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'signature' };
      let payload: Payload;
      try {
        payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Payload;
      } catch {
        return { ok: false, reason: 'malformed' };
      }
      if (payload.v !== 1 || typeof payload.at !== 'number' || !Array.isArray(payload.calls)) return { ok: false, reason: 'malformed' };
      if (now() - payload.at > TICKET_MAX_AGE_MS) return { ok: false, reason: 'expired' };
      if (payload.messageId !== claims.messageId) return { ok: false, reason: 'other-message' };
      if (payload.calls.length !== claims.calls.length || payload.calls.some((id, index) => id !== claims.calls[index])) {
        return { ok: false, reason: 'other-calls' };
      }
      return { ok: true, id: payload.id };
    },
  };
}

export type Tickets = ReturnType<typeof createTickets>;
