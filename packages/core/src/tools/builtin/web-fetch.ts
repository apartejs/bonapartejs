/**
 * web_fetch reads a page of the web, as text (security rule 4). Its effect is
 * Network: what it reads leaves the machine first. Only http and https;
 * never a local, private or link-local address — the machine, the network it
 * sits in, a cloud's metadata service — unless a setting allows it; every
 * redirect is checked again before it is followed. A name is resolved, and
 * all its addresses checked, before anything is asked of it.
 *
 * Not covered (yet): a name that resolves to a public address when checked
 * and to a private one when fetched (DNS rebinding) — that needs the address
 * pinned for the connection.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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

/** Is it an address of the internet — not the machine, a private network, link-local, multicast or reserved? */
export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  const kind = isIP(ip);
  if (kind === 4) return publicV4(ip);
  if (kind !== 6) return false;
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return publicV4(mapped[1]!);
  if (lower === '::' || lower === '::1') return false;
  const first = Number.parseInt(lower.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return false; // unique local, fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false; // link-local, fe80::/10
  if ((first & 0xff00) === 0xff00) return false; // multicast
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

export function createWebFetch(options: WebFetchOptions = {}): BuiltinTool {
  const fetchPage = options.fetch ?? globalThis.fetch;
  const resolveName = options.lookup ?? (async (host: string) => (await dnsLookup(host, { all: true })).map((found) => found.address));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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
      return `Refused: ${url.host} is a local or private address (this machine, or the network it is in). Only addresses of the internet are read.`;
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
        return refused(`The page could not be read: ${describeError(error)}`);
      }
    },
  };
}

export const webFetch = createWebFetch();
