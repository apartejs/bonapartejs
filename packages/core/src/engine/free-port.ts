/**
 * A port of this machine free now, as the system gives one: what a managed llama-server listens on, chosen at each
 * launch — a fixed port (8763 before) held by another program kept the engine from starting, and a relaunch on the
 * port just let go met it taken again (GitHub's runner, 2026-11-21).
 */

import { createServer } from 'node:net';

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('No free port on 127.0.0.1.');
  return address.port;
}
