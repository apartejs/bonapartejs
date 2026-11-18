/**
 * The hub models are downloaded from, for the tests (task 9.5): a local
 * server that serves files at `/<owner>/<repo>/resolve/main/<file>`, as
 * Hugging Face does. It counts the downloads: a test proves that nothing was
 * fetched before the person asked.
 */

import { createServer } from 'node:http';

export interface FakeModelHub {
  /** What `modelHub` is set to. */
  url: string;
  /** How many times a file was asked for. */
  readonly downloads: number;
  close(): Promise<void>;
}

/** `files`: the body of each file, by `owner/repo/file`. `paceMs`: a pause between two chunks, for a download that lasts. */
export async function startFakeModelHub(options: { files: Record<string, Uint8Array>; paceMs?: number }): Promise<FakeModelHub> {
  let downloads = 0;
  const server = createServer((req, res) => {
    const match = /^\/([^/]+\/[^/]+)\/resolve\/main\/(.+)$/.exec(req.url ?? '');
    const body = match ? options.files[`${match[1]}/${decodeURIComponent(match[2]!)}`] : undefined;
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    downloads += 1;
    res.writeHead(200, { 'content-length': body.length });
    if (!options.paceMs) {
      res.end(body);
      return;
    }
    // In four pieces, a pause between them.
    const piece = Math.ceil(body.length / 4);
    let at = 0;
    const next = (): void => {
      if (at >= body.length || res.destroyed) {
        res.end();
        return;
      }
      res.write(body.subarray(at, at + piece));
      at += piece;
      setTimeout(next, options.paceMs);
    };
    next();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    get downloads() {
      return downloads;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
