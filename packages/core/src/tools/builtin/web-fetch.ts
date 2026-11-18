/**
 * web_fetch reads a page of the web, as text (security rule 4). Its effect is
 * Network: what it reads leaves the machine first. Only http and https;
 * never a local, private or link-local address — the machine, the network it
 * sits in, a cloud's metadata service — unless a setting allows it; every
 * redirect is checked again before it is followed. A name is resolved, and
 * all its addresses checked, before anything is asked of it — and the
 * connection is made through the same checked resolution: a name that answers
 * a public address, then a private one (DNS rebinding), reaches nothing
 * (audit 13.4).
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { ToolOutput } from '../types.js';
import { describeError, refused, text, type BuiltinTool } from './common.js';

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CHARS = 2_000_000;

function publicV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return a < 224;
}

/** An IPv6 address as its eight groups, whatever its spelling: `::`, a dotted IPv4 tail, a zone. */
function groupsOf(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/%.*$/, '');
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail, ...rest] = text.split('::');
  if (rest.length > 0) return null;
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...right].map((group) => Number.parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => group >= 0 && group <= 0xffff) ? groups : null;
}

/** The IPv4 address held in two groups of an IPv6 one. */
const v4Of = (high: number, low: number): string => `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;

/**
 * Is it an address of the internet — not the machine, a private network, link-local, multicast
 * or reserved? An IPv4 address carried in IPv6 is judged as itself, in every spelling a URL can
 * give it (`[::ffff:7f00:1]` is how WHATWG writes `[::ffff:127.0.0.1]`): mapped, compatible,
 * translated, NAT64 and 6to4.
 */
export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  const kind = isIP(ip);
  if (kind === 4) return publicV4(ip);
  if (kind !== 6) return false;
  const g = groupsOf(ip);
  if (!g) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const zeroTo = (end: number): boolean => g.slice(0, end).every((group) => group === 0);
  if (zeroTo(8)) return false; // ::
  if (zeroTo(7) && g7 === 1) return false; // ::1
  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), ::ffff:0:a.b.c.d (translated).
  if (zeroTo(5) && g5 === 0xffff) return publicV4(v4Of(g6, g7));
  if (zeroTo(6)) return publicV4(v4Of(g6, g7));
  if (zeroTo(4) && g4 === 0xffff && g5 === 0) return publicV4(v4Of(g6, g7));
  // NAT64: the well-known prefix carries an IPv4 address; the local-use one (64:ff9b:1::/48) is private.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return publicV4(v4Of(g6, g7));
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return false;
  if (g0 === 0x2002) return publicV4(v4Of(g1, g2)); // 6to4
  if (g0 === 0x2001 && g1 === 0xdb8) return false; // documentation
  if ((g0 & 0xfe00) === 0xfc00) return false; // unique local, fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return false; // link-local, fe80::/10
  if ((g0 & 0xff00) === 0xff00) return false; // multicast
  return true;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** A page as the model can read it: no script, no style, no tag; one block a line. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article|\/header|\/footer)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

export interface WebFetchOptions {
  fetch?: typeof globalThis.fetch;
  /** The addresses a name resolves to. */
  lookup?: (host: string) => Promise<string[]>;
  /** The setting that lets local and private addresses through (off by default). */
  allowPrivate?: () => boolean;
  timeoutMs?: number;
}

/** The marker of a connection refused because its name resolved to a local or private address. */
class PrivateAddressError extends Error {}

const LOCAL_REFUSAL = (host: string) =>
  `Refused: ${host} is a local or private address (this machine, or the network it is in). Only addresses of the internet are read.`;

export function createWebFetch(options: WebFetchOptions = {}): BuiltinTool {
  const resolveName = options.lookup ?? (async (host: string) => (await dnsLookup(host, { all: true })).map((found) => found.address));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // The connection resolves the name through the same check: what it connects to is an address it judged.
  const pinned = new Agent({
    connect: {
      lookup: (hostname: string, lookupOptions: { all?: boolean }, callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void) => {
        resolveName(hostname).then(
          (addresses) => {
            if (addresses.length === 0) return callback(new Error(`The address ${hostname} cannot be resolved.`), '', 4);
            if (!options.allowPrivate?.() && addresses.some((address) => !isPublicAddress(address))) {
              return callback(new PrivateAddressError(LOCAL_REFUSAL(hostname)), '', 4);
            }
            const found = addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
            if (lookupOptions.all) return callback(null, found);
            return callback(null, found[0]!.address, found[0]!.family);
          },
          (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), '', 4),
        );
      },
    } as never,
  });
  const fetchPage = options.fetch ?? ((input: string, init: RequestInit) => undiciFetch(input, { ...(init as object), dispatcher: pinned }) as unknown as Promise<Response>);

  /** Null when the host may be read; else why not, for the model. */
  async function refusalFor(url: URL): Promise<string | null> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return `Only http and https addresses are read: ${url.href}`;
    if (options.allowPrivate?.()) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: string[];
    try {
      addresses = isIP(host) ? [host] : await resolveName(host);
    } catch (error) {
      return `The address ${host} cannot be resolved: ${describeError(error)}`;
    }
    if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
      return LOCAL_REFUSAL(url.host);
    }
    return null;
  }

  return {
    def: {
      name: 'web_fetch',
      description: 'Read a web page (http or https) and return its text.',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The address of the page, http or https.' } },
        required: ['url'],
      },
      effect: 'network',
      source: 'builtin',
      where: 'core',
    },
    handler: async (call, ctx): Promise<ToolOutput> => {
      const raw = text(call.input, 'url');
      if (!raw) return refused('Missing argument: url.');
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return refused(`Not a web address: ${raw}`);
      }
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]);
      try {
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
          const refusal = await refusalFor(url);
          if (refusal) return refused(refusal);
          const response = await fetchPage(url.href, { redirect: 'manual', signal, headers: { 'user-agent': 'bonaparte' } });
          const location = response.headers.get('location');
          if (response.status >= 300 && response.status < 400 && location) {
            url = new URL(location, url);
            continue;
          }
          const type = (response.headers.get('content-type') ?? '').toLowerCase();
          const body = (await response.text()).slice(0, MAX_CHARS);
          const readable = type.includes('html') ? htmlToText(body) : body;
          const isText = type === '' || type.startsWith('text/') || type.includes('json') || type.includes('xml') || type.includes('javascript');
          if (!isText) return refused(`Not text: ${url.href} is ${type}.`);
          return { content: `URL: ${url.href}\nStatus: ${response.status}\n\n${readable}` };
        }
        return refused(`Too many redirects from ${raw}.`);
      } catch (error) {
        if (ctx.signal.aborted) return refused('The page was not read: the turn was stopped.');
        for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
          if (cause instanceof PrivateAddressError) return refused(cause.message);
        }
        return refused(`The page could not be read: ${describeError(error)}`);
      }
    },
  };
}

export const webFetch = createWebFetch();
