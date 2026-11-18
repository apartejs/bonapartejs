/**
 * web_fetch reads a page of the web (security rule 4): its effect is
 * Network, not Read; only http and https; never a local, private or
 * link-local address — the machine, the network it sits in, a cloud's
 * metadata service — unless a setting says otherwise; every redirect is
 * checked again. No test here goes on the network: fetch and the name
 * lookup are given.
 */

import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../types.js';
import { createWebFetch, isPublicAddress } from './web-fetch.js';

const ctx: ToolContext = { conversationId: 'c1', roots: [], nCtx: 8_192, signal: new AbortController().signal };

/** A web where each address answers what the test says, and names resolve as the test says. */
function web(pages: Record<string, { status?: number; type?: string; body?: string; location?: string }>, names: Record<string, string[]> = {}) {
  const asked: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    const page = pages[url];
    if (!page) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    const headers: Record<string, string> = { 'content-type': page.type ?? 'text/html; charset=utf-8' };
    if (page.location) headers['location'] = page.location;
    return new Response(page.body ?? '', { status: page.status ?? 200, headers });
  }) as typeof globalThis.fetch;
  const lookup = async (host: string) => names[host] ?? ['93.184.216.34'];
  return { fetch, lookup, asked };
}

const run = (tool: ReturnType<typeof createWebFetch>, url: unknown) => tool.handler({ id: 't1', name: 'web_fetch', input: { url } }, ctx);

describe('isPublicAddress', () => {
  it('knows the machine, the private networks, link-local and the reserved ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '224.0.0.1']) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) {
      expect(isPublicAddress(ip)).toBe(true);
    }
  });

  it('sees through an IPv4 address written in IPv6, in every spelling a URL gives it', () => {
    // WHATWG URL writes [::ffff:127.0.0.1] as [::ffff:7f00:1]: the hex form is what reaches the check.
    expect(new URL('http://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
    for (const ip of [
      '::ffff:7f00:1',
      '[::ffff:7f00:1]',
      '::ffff:a9fe:a9fe',
      '::ffff:c0a8:101',
      '0:0:0:0:0:ffff:7f00:1',
      '::ffff:0:7f00:1',
      '::7f00:1',
      '::127.0.0.1',
      '64:ff9b::7f00:1',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b:1::1',
      '2002:7f00:1::1',
      '2002:c0a8:101::1',
      '2001:db8::1',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['::ffff:5db8:d822', '64:ff9b::808:808', '2002:808:808::1']) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
  });
});

describe('web_fetch', () => {
  it('is a tool of the network, not of reading', () => {
    expect(createWebFetch().def.effect).toBe('network');
  });

  it('reads a page as text: no script, no style, no tag', async () => {
    const { fetch, lookup } = web({
      'https://example.com/': { body: '<html><head><style>p{}</style><script>evil()</script></head><body><h1>Hello</h1><p>world &amp; more</p></body></html>' },
    });
    const result = await run(createWebFetch({ fetch, lookup }), 'https://example.com/');
    expect(result.content).toContain('Hello');
    expect(result.content).toContain('world & more');
    expect(result.content).not.toMatch(/evil|<p>|p\{\}/);
  });

  it('refuses what is not http or https', async () => {
    const { fetch, lookup, asked } = web({});
    for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'not a url']) {
      expect(await run(createWebFetch({ fetch, lookup }), url)).toMatchObject({ failed: true });
    }
    expect(asked).toEqual([]);
  });

  it('refuses the machine, its network and the metadata service — by name or by address', async () => {
    const { fetch, lookup, asked } = web({}, { 'intranet.local': ['192.168.1.10'], localhost: ['127.0.0.1'] });
    const tool = createWebFetch({ fetch, lookup });
    for (const url of [
      'http://localhost:3000/',
      'http://intranet.local/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://10.0.0.1/',
      'http://[::ffff:127.0.0.1]:3000/',
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
    ]) {
      const result = await run(tool, url);
      expect(result).toMatchObject({ failed: true });
      expect(result.content).toMatch(/local or private address/);
    }
    expect(asked).toEqual([]);
  });

  it('checks every redirect again: a public page that sends to a private one is refused', async () => {
    const { fetch, lookup, asked } = web({ 'https://example.com/go': { status: 302, location: 'http://192.168.0.1/admin' } });
    const result = await run(createWebFetch({ fetch, lookup }), 'https://example.com/go');
    expect(result).toMatchObject({ failed: true });
    expect(asked).toEqual(['https://example.com/go']);
  });

  it('reaches a local address when the setting allows it', async () => {
    const { fetch, lookup } = web({ 'http://localhost:3000/': { type: 'text/plain', body: 'dev server' } }, { localhost: ['127.0.0.1'] });
    const result = await run(createWebFetch({ fetch, lookup, allowPrivate: () => true }), 'http://localhost:3000/');
    expect(result.content).toContain('dev server');
  });

  it('says the status of a page that is not there, and refuses what is not text', async () => {
    const { fetch, lookup } = web({ 'https://example.com/img': { type: 'image/png', body: 'PNG' } });
    const tool = createWebFetch({ fetch, lookup });
    expect((await run(tool, 'https://example.com/missing')).content).toMatch(/404/);
    expect(await run(tool, 'https://example.com/img')).toMatchObject({ failed: true });
  });
});

describe('the address checked is the address connected to (audit 13.4: DNS rebinding)', () => {
  async function local(body: string) {
    const { createServer } = await import('node:http');
    let hits = 0;
    const server = createServer((_request, response) => {
      hits += 1;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    return { port, hits: () => hits, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }

  it('connects to the address the name was resolved to when it was checked, not one resolved again', async () => {
    const server = await local('pinned');
    try {
      const tool = createWebFetch({ lookup: async () => ['127.0.0.1'], allowPrivate: () => true });
      const result = await run(tool, `http://pinned.invalid:${server.port}/`);
      expect(result).toMatchObject({ content: expect.stringContaining('pinned') });
    } finally {
      await server.close();
    }
  });

  it('a name that answers a public address, then a local one, never reaches the local one', async () => {
    const server = await local('secret of the machine');
    try {
      let asked = 0;
      const tool = createWebFetch({ lookup: async () => (asked++ === 0 ? ['93.184.216.34'] : ['127.0.0.1']) });
      const result = await run(tool, `http://rebind.invalid:${server.port}/`);
      expect(result).toMatchObject({ failed: true, content: expect.stringMatching(/local or private/) });
      expect(server.hits()).toBe(0);
    } finally {
      await server.close();
    }
  });
});
