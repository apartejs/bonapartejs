/**
 * Serves everything under `bonaparte://app/`: a turn of conversation goes to
 * the core, any other path is a file of the window.
 *
 * In the packaged app the page and the agent endpoint share one origin, so no
 * CORS is involved. In development the page comes from the dev server, another
 * origin: the handler then answers the preflight and names that one origin.
 */

import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { APP_SCHEME } from '@aparte/bonaparte-shared';
import { resolveAppFile } from './security.js';

export interface AppProtocolOptions {
  /** The core's agent handler. */
  handler: (request: Request) => Promise<Response>;
  /** The folder of the built window. */
  rendererDir: string;
  devServerUrl?: string | undefined;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

export function registerAppProtocol(options: AppProtocolOptions): void {
  const devOrigin = options.devServerUrl ? new URL(options.devServerUrl).origin : undefined;

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response(null, { status: 404 });

    if (url.pathname.startsWith('/agent/')) {
      const fromDev = devOrigin !== undefined && request.headers.get('origin') === devOrigin;
      if (fromDev && request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(devOrigin) });
      }
      const response = await options.handler(request);
      if (!fromDev) return response;
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(corsHeaders(devOrigin))) headers.set(name, value);
      return new Response(response.body, { status: response.status, headers });
    }

    const file = resolveAppFile(options.rendererDir, url.pathname);
    if (!file) return new Response(null, { status: 404 });
    // A file that is not there is an answer too, not a failure of this process.
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response(null, { status: 404 }));
  });
}
