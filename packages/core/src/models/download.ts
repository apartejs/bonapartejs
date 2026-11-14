/**
 * A download bonaparte runs (a llama.cpp build now, a model later). It
 * writes beside its destination (`<dest>.part`), resumes a cut download with
 * a range request, and keeps the file only if its SHA-256 is the one
 * announced: a file that does not match is deleted, never run.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';

export class DigestMismatchError extends Error {
  constructor(readonly url: string) {
    super(`The file downloaded from ${url} is not the one announced (its SHA-256 differs): it was deleted.`);
    this.name = 'DigestMismatchError';
  }
}

export interface DownloadOptions {
  url: string;
  dest: string;
  /** The SHA-256 the file must have, in hex. */
  sha256: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  onProgress?: (progress: { done: number; total: number | null }) => void;
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function downloadFile(options: DownloadOptions): Promise<void> {
  const part = `${options.dest}.part`;
  let have = await stat(part).then(
    (found) => found.size,
    () => 0,
  );
  const response = await (options.fetch ?? fetch)(options.url, {
    headers: { 'user-agent': 'bonaparte', ...(have > 0 ? { range: `bytes=${have}-` } : {}) },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok || !response.body) throw new Error(`The download failed: HTTP ${response.status} (${options.url}).`);
  // A server that ignores the range sends the whole file again: start over.
  if (response.status !== 206) have = 0;
  const length = Number(response.headers.get('content-length'));
  const total = Number.isFinite(length) && length > 0 ? have + length : null;

  const file = await open(part, have > 0 ? 'a' : 'w');
  let done = have;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      await file.write(chunk);
      done += chunk.byteLength;
      options.onProgress?.({ done, total });
      options.signal?.throwIfAborted();
    }
  } finally {
    await file.close();
  }

  if ((await sha256Of(part)) !== options.sha256.toLowerCase()) {
    await rm(part, { force: true });
    throw new DigestMismatchError(options.url);
  }
  await rename(part, options.dest);
}
