/**
 * llama.cpp's releases, for the tests: a local server that lists one build
 * (`GET /releases`, GitHub's shape) with a package for this machine, and
 * serves that package — a real archive, packed by the system's tar, with a
 * `llama-server` in it. It counts the downloads: a test proves that nothing
 * was fetched before the person asked.
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tarCommand } from '../engine/llama-install.js';
import { packageSlug } from '../engine/llama-release.js';
import { runShort } from '../engine/process-probe.js';

export interface FakeLlamaReleases {
  /** What `llamaReleases` is set to. */
  url: string;
  build: string;
  bytes: number;
  /** How many times the package was downloaded. */
  readonly downloads: number;
  close(): Promise<void>;
}

export async function startFakeLlamaReleases(options: { build?: string } = {}): Promise<FakeLlamaReleases> {
  const build = options.build ?? 'b12383';
  const slug = packageSlug(process.platform, process.arch);
  if (!slug) throw new Error(`llama.cpp publishes no package for ${process.platform} ${process.arch}`);
  const name = `llama-${build}-bin-${slug}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;

  // A package as llama.cpp publishes one. Its format is tar.gz even under a
  // .zip name: Windows' tar reads either, by their content.
  const work = await mkdtemp(join(tmpdir(), 'bp-releases-'));
  const content = join(work, 'content');
  await mkdir(content, { recursive: true });
  await writeFile(join(content, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'), 'fake llama-server');
  await writeFile(join(content, 'LICENSE'), 'MIT');
  const archive = join(work, 'package.tar.gz');
  const packed = await runShort(tarCommand(process.platform, process.env), ['-czf', archive, '-C', content, '.'], 30_000);
  if (packed?.code !== 0) throw new Error(`tar could not pack the fake package: ${packed?.stdout}`);
  const body = await readFile(archive);
  await rm(work, { recursive: true, force: true });
  const digest = createHash('sha256').update(body).digest('hex');

  let downloads = 0;
  const server = createServer((req, res) => {
    const port = (server.address() as { port: number }).port;
    if (req.url === '/releases') {
      const release = {
        tag_name: build,
        assets: [
          {
            name,
            size: body.length,
            digest: `sha256:${digest}`,
            browser_download_url: `http://127.0.0.1:${port}/download/${name}`,
          },
        ],
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([release]));
      return;
    }
    if (req.url === `/download/${name}`) {
      downloads += 1;
      res.writeHead(200, { 'content-length': body.length });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/releases`,
    build,
    bytes: body.length,
    get downloads() {
      return downloads;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
