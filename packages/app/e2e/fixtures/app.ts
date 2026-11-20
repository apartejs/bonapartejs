/**
 * The one way an end-to-end test launches bonaparte. It starts a fake
 * llama-server, gives the app a data folder of its own (so that a test never
 * touches the person's real conversations), and launches the built app with
 * `BONAPARTE_E2E=1`: its window stays off the screen, transparent and never
 * activated, and an error goes to the console, never to a native box.
 *
 * A spec asks for the `launch` fixture; it closes what it launched, and says
 * what the app wrote to its console when the test failed.
 */

import {
  startFakeLlamaReleases,
  startFakeLlamaServer,
  startFakeOpenAIServer,
  startFakeModelHub,
  type FakeModelHub,
  type FakeOpenAIServer,
  type FakeOpenAIServerOptions,
  writeFakeGguf,
  type FakeGgufOptions,
  type FakeLlamaReleases,
  type FakeLlamaServer,
  type FakeLlamaServerOptions,
} from '@aparte/bonaparte-core/testing';
import { spawnHidden } from '@aparte/bonaparte-core';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { builtAppEntry } from './app-entry.js';
import { appEnvironment } from './app-env.js';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** What the app launches instead of llama.cpp in a managed test: the core's fake binary. */
const FAKE_LLAMA_BIN = join(appRoot, '..', 'core', 'src', 'testing', 'fake-llama-bin.mjs');
const FAKE_GH = join(appRoot, '..', 'core', 'src', 'testing', 'fake-gh.mjs');
/** A stdio MCP server for the tests (task 10.5): `echo` read-only, `write_note` not, and others. */
export const FAKE_MCP_SERVER = join(appRoot, '..', 'core', 'src', 'testing', 'fake-mcp-server.mjs');

const GiB = 1024 ** 3;

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no free port');
  return address.port;
}

export interface LaunchOptions {
  /** The fake engine: what it answers, how fast. */
  engine?: FakeLlamaServerOptions;
  /** The language of the interface (French by default, as on the design canvas). */
  locale?: 'fr' | 'en';
  /** Extra environment for the app. */
  env?: Record<string, string>;
  /**
   * A managed engine instead of a server that runs: the app finds these
   * models (GGUF headers written for the test) and launches the fake binary
   * when one is loaded. The card is said to have `gpuBytes` (24 GiB).
   * `releases`: llama.cpp publishes a build (a local server, never GitHub).
   * `llama: 'missing'`: no llama.cpp on the machine.
   */
  managed?: {
    models: Record<string, FakeGgufOptions>;
    gpuBytes?: number;
    releases?: boolean;
    llama?: 'found' | 'missing';
  };
  /**
   * The data folder of an earlier launch: the app starts again on what it
   * kept — its conversations, its memory. A model already there is not
   * written again: its fingerprint (its date) still matches its saved states.
   */
  dataDir?: string;
  /** Keep the data folder when this launch closes, for a later one (the fixture removes it at the end of the test). */
  keepData?: boolean;
  /** Plugins of a third party already added (task 11.1): their folders under `<data>/plugins/<id>/`, file by file. */
  plugins?: Record<string, Record<string, string>>;
  /** The app's settings as the person would have left them (`settings` in the configuration file). */
  settings?: Record<string, unknown>;
  /** Built-in entries off by default that the person switched on (`config/plugins.json`'s `on`): « conversation-plugins ». */
  pluginsOn?: string[];
  /** GitHub's CLI, a fake one: its pull request (as `gh pr view --json` says it), or none. Without it, the app has no CLI. */
  gh?: { pr?: Record<string, unknown> };
  /**
   * A service that speaks OpenAI's API (task 9.3), already added in the app's providers as « Ollama » (id
   * `ollama`, no key): what it answers, its models.
   */
  service?: Omit<FakeOpenAIServerOptions, 'key'>;
  /** `false`: the service runs, but the app does not know it yet — the person adds it (task 9.6). */
  serviceAdded?: boolean;
  /**
   * The hub the recommended models are downloaded from (task 9.5), a local one, and the catalogue the app
   * recommends: one small model per name, served by the hub. `paceMs`: a download that lasts.
   */
  hub?: { models: Record<string, { family: 'gemma' | 'qwen'; gguf?: FakeGgufOptions; replaces?: string[] }>; paceMs?: number };
  /**
   * The public search engine the hidden page reads (task 10.4), a local one shaped as DuckDuckGo's HTML page:
   * its results, or a verification page. Without it, a test run searches nothing.
   */
  search?: { results?: { title: string; href: string; snippet: string }[]; blocked?: boolean };
  /** The MCP servers of the app (task 10.5), as `config/mcp-servers.json` holds them: `{ <name>: entry }`. */
  mcp?: Record<string, Record<string, unknown>>;
  /** Pages served on this machine for the built-in browser (task 10.1), by path: `{ '/rapport': '<html>…' }`. */
  pages?: Record<string, string>;
  /**
   * A project on the app's home folder, made before the launch (default): a new conversation works in it, as a
   * code conversation that may change files. `false`: no project — a new conversation is a discussion (task 9.7).
   */
  project?: boolean;
  /** The app as electron-builder packed it (task 13.2): its executable, launched instead of `out/` under Electron. */
  executable?: string;
}

/** One completion the managed engine was asked for. */
export interface EngineRequest {
  promptChars: number;
  /** The tokens the engine counts in the prompt. */
  promptTokens: number;
  /** 0 is a reading without writing: a seed being prepared, a prefill. */
  nPredict: number | null;
  /** How the prompt opens: its first characters, which say the family it was rendered by. */
  opens: string;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  server: FakeLlamaServer;
  dataDir: string;
  /** The app's home folder: without a project, the perimeter of its tools. */
  home: string;
  /** The port of the managed engine, in a managed test. */
  enginePort?: number;
  /** llama.cpp's releases, when the test asked for them. */
  releases?: FakeLlamaReleases;
  /** The service the test asked for: what it was sent. */
  service?: FakeOpenAIServer;
  /** The hub the test asked for: how many files it served. */
  hub?: FakeModelHub;
  /** The search engine the test asked for: the queries it was asked. */
  search?: { queries: string[] };
  /** The pages the test serves: their address. */
  pages?: { url: string };
  /** What the managed engine was asked, in order: every completion it received. */
  engineRequests(): Promise<EngineRequest[]>;
  /** The addresses the window has loaded, or failed to load, since it was launched: none, if it stayed on its page. */
  navigations(): Promise<string[]>;
  /** What the app wrote to its console, main process and window. */
  output(): string;
  /**
   * Launches the app a second time, on the same data folder, as the person would by
   * clicking its icon again: resolves with that second process's exit code.
   */
  launchAgain(): Promise<number | null>;
  close(): Promise<void>;
}

/** Closes the app, and makes sure of it: a test never leaves an Electron behind. */
async function closeApp(app: ElectronApplication): Promise<void> {
  let child: ReturnType<ElectronApplication['process']>;
  try {
    child = app.process();
  } catch {
    return; // It quit by itself (a test asked it to): Playwright has let go of it already.
  }
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  await Promise.race([app.close().catch(() => undefined), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await Promise.race([exited, delay(2_000)]);
}

export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  // Before anything is started: no build, no Electron.
  const entry = builtAppEntry(appRoot);
  // The inventory of tools weighs some 3,200 of the fake engine's tokens (four characters a token): a context of 16 k
  // leaves the tests room for their turns, as a real model's 8 k does for its own count (phase 10).
  const server = await startFakeLlamaServer({ nCtx: 16_384, ...options.engine });
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'bonaparte-e2e-')));
  const requestsFile = join(dataDir, 'engine-requests.jsonl');
  const home = `${dataDir}-home`;
  const lines: string[] = [];
  const output = (): string => lines.join('');
  let app: ElectronApplication | undefined;
  let releases: FakeLlamaReleases | undefined;
  let service: FakeOpenAIServer | undefined;
  let hub: FakeModelHub | undefined;
  let searchEngine: { url: string; queries: string[]; close(): Promise<void> } | undefined;
  let pageServer: { url: string; close(): Promise<void> } | undefined;

  // Once: a test may close the app itself, and the fixture closes what is left after it.
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      if (app) await closeApp(app);
      await server.close();
      await releases?.close();
      await service?.close();
      await hub?.close();
      await searchEngine?.close();
      await pageServer?.close();
      if (!options.keepData && !options.dataDir) {
        await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
        await rm(home, { recursive: true, force: true }).catch(() => undefined);
      }
    })());
  const engineRequests = async (): Promise<EngineRequest[]> => {
    const text = await readFile(requestsFile, 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EngineRequest);
  };

  try {
    await mkdir(join(dataDir, 'config'), { recursive: true });
    // Beside the data folder, never in it: bonaparte's own data is a path the policy always asks about.
    await mkdir(home, { recursive: true });
    const managedEnv: Record<string, string> = {};
    if (options.gh) {
      const state = join(dataDir, 'fake-gh.json');
      await writeFile(state, JSON.stringify(options.gh.pr ? { pr: options.gh.pr } : {}));
      Object.assign(managedEnv, { BONAPARTE_E2E_GH_COMMAND: JSON.stringify([process.execPath, FAKE_GH]), FAKE_GH_STATE: state });
    }
    let enginePort: number | undefined;
    if (options.managed) {
      const models = join(dataDir, 'models');
      await mkdir(models, { recursive: true });
      for (const [name, model] of Object.entries(options.managed.models)) {
        const file = join(models, `${name}.gguf`);
        const there = await access(file).then(
          () => true,
          () => false,
        );
        if (!there) await writeFakeGguf(file, model);
      }
      enginePort = await freePort();
      if (options.managed.releases) releases = await startFakeLlamaReleases();
      // No llama.cpp: a program that is not there stands for the one on the PATH.
      const llama =
        options.managed.llama === 'missing' ? [join(dataDir, 'no-llama-here.exe')] : [process.execPath, FAKE_LLAMA_BIN];
      Object.assign(managedEnv, {
        ...(releases ? { BONAPARTE_E2E_LLAMA_RELEASES: releases.url } : {}),
        BONAPARTE_MODEL_DIRS: models,
        BONAPARTE_E2E_LLAMA_COMMAND: JSON.stringify(llama),
        BONAPARTE_E2E_GPU_BYTES: String(options.managed.gpuBytes ?? 24 * GiB),
        BONAPARTE_E2E_ENGINE_PORT: String(enginePort),
        FAKE_LLAMA_REQUESTS: requestsFile,
      });
    }
    if (options.pluginsOn) {
      await writeFile(join(dataDir, 'config', 'plugins.json'), JSON.stringify({ installed: {}, off: [], on: options.pluginsOn, projects: {} }));
    }
    // A later launch on the same folder keeps the settings the app wrote there; the test's are laid over them.
    const written = await readFile(join(dataDir, 'config', 'global.json'), 'utf8')
      .then((text) => (JSON.parse(text) as { settings?: Record<string, unknown> }).settings ?? {})
      .catch(() => ({}));
    const merged = { ...written, ...options.settings };
    const settings = Object.keys(merged).length > 0 ? { settings: merged } : {};
    // A code conversation needs a project (task 9.7): the home folder's, unless the test asks for none.
    const projectsFile = join(dataDir, 'projects.json');
    const projectsThere = await access(projectsFile).then(
      () => true,
      () => false,
    );
    if (options.project !== false && !projectsThere) {
      const now = new Date().toISOString();
      await writeFile(
        projectsFile,
        JSON.stringify({ projects: [{ id: 'maison', name: 'maison', roots: [home], defaultMode: 'repetition', createdAt: now, updatedAt: now }] }),
      );
    }
    if (options.hub) {
      const files: Record<string, Uint8Array> = {};
      const catalogue = [];
      for (const [name, model] of Object.entries(options.hub.models)) {
        const file = join(dataDir, `hub-${name}.gguf`);
        await writeFakeGguf(file, model.gguf ?? { paddingBytes: 64 * 1024 });
        const body = await readFile(file);
        await rm(file, { force: true });
        const repo = `${model.family === 'gemma' ? 'google' : 'Qwen'}/${name}-gguf`;
        files[`${repo}/${name}.gguf`] = body;
        catalogue.push({
          id: name,
          family: model.family,
          name,
          repo,
          file: `${name}.gguf`,
          bytes: body.length,
          sha256: createHash('sha256').update(body).digest('hex'),
          context: 32_768,
          fromGiB: 0,
          // A new version of a model on the disk (task 13.1).
          ...(model.replaces ? { replaces: model.replaces } : {}),
        });
      }
      hub = await startFakeModelHub({ files, ...(options.hub.paceMs ? { paceMs: options.hub.paceMs } : {}) });
      Object.assign(managedEnv, { BONAPARTE_E2E_MODEL_HUB: hub.url, BONAPARTE_E2E_MODEL_CATALOGUE: JSON.stringify(catalogue) });
    }
    if (options.pages) pageServer = await startPageServer(options.pages);
    for (const [id, files] of Object.entries(options.plugins ?? {})) {
      await mkdir(join(dataDir, 'plugins', id), { recursive: true });
      for (const [name, text] of Object.entries(files)) await writeFile(join(dataDir, 'plugins', id, name), text);
    }
    if (options.mcp) {
      await writeFile(join(dataDir, 'config', 'mcp-servers.json'), JSON.stringify({ mcpServers: options.mcp }));
    }
    if (options.search) {
      searchEngine = await startFakeSearchEngine(options.search);
      Object.assign(managedEnv, { BONAPARTE_E2E_SEARCH_ENGINE: `${searchEngine.url}/html/?q=` });
    }
    if (options.service) {
      service = await startFakeOpenAIServer(options.service);
    }
    if (service && options.serviceAdded !== false) {
      await writeFile(
        join(dataDir, 'config', 'providers.json'),
        JSON.stringify({ providers: [{ id: 'ollama', kind: 'openai-compat', label: 'Ollama', url: `${service.url}/v1`, server: 'ollama' }] }),
      );
    }
    if (!options.managed) {
      await writeFile(
        join(dataDir, 'config', 'global.json'),
        JSON.stringify({ backend: { mode: 'remote', url: server.url }, ...settings }),
      );
    } else if (Object.keys(merged).length > 0) {
      await writeFile(join(dataDir, 'config', 'global.json'), JSON.stringify(settings));
    }

    const env = appEnvironment(process.env, {
      dataDir,
      locale: options.locale ?? 'fr',
      home,
      extra: { ...managedEnv, ...options.env },
    });
    app = options.executable
      ? await electron.launch({ executablePath: options.executable, args: [], cwd: appRoot, env, timeout: 30_000 })
      : await electron.launch({ args: [entry], cwd: appRoot, env, timeout: 30_000 });
    const child = app.process();
    child.stdout?.on('data', (chunk: Buffer) => lines.push(`[main] ${chunk.toString()}`));
    child.stderr?.on('data', (chunk: Buffer) => lines.push(`[main] ${chunk.toString()}`));

    const watched = new WeakSet<Page>();
    const watch = (page: Page): void => {
      if (watched.has(page)) return;
      watched.add(page);
      page.on('console', (message) => lines.push(`[window:${message.type()}] ${message.text()}\n`));
      page.on('pageerror', (error) => lines.push(`[window:error] ${error.message}\n`));
    };
    app.on('window', watch);

    const page = await app.firstWindow({ timeout: 30_000 });
    watch(page);
    await page.waitForLoadState('domcontentloaded');

    // From here on, every document the window loads, or fails to load, is
    // recorded in the main process: a test can say "it went nowhere" without
    // waiting for an address to change. (Not `did-start-navigation`: that one
    // fires for a navigation the app is about to refuse, too.)
    const running = app;
    await running.evaluate(({ BrowserWindow }) => {
      const record = globalThis as { __navigations?: string[] };
      record.__navigations = [];
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.on('did-navigate', (_event, url) => record.__navigations?.push(url));
        window.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
          // -3 is a navigation that was cancelled: one the app refused.
          if (isMainFrame && code !== -3) record.__navigations?.push(url);
        });
      }
    });
    const navigations = (): Promise<string[]> =>
      running.evaluate(() => (globalThis as { __navigations?: string[] }).__navigations ?? []);

    // Electron itself, the program Playwright launched: run again on the same entry and folder.
    const electronPath = createRequire(import.meta.url)('electron') as string;
    const launchAgain = (): Promise<number | null> =>
      new Promise((resolve, reject) => {
        const second = spawnHidden(electronPath, [entry], { cwd: appRoot, env });
        second.stdout?.on('data', (chunk: Buffer) => lines.push(`[second] ${chunk.toString()}`));
        second.stderr?.on('data', (chunk: Buffer) => lines.push(`[second] ${chunk.toString()}`));
        const timer = setTimeout(() => {
          second.kill();
          reject(new Error('The second launch did not quit within 20 s.'));
        }, 20_000);
        second.once('exit', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });

    return {
      app,
      page,
      server,
      dataDir,
      home,
      launchAgain,
      ...(enginePort !== undefined ? { enginePort } : {}),
      ...(releases ? { releases } : {}),
      ...(service ? { service } : {}),
      ...(hub ? { hub } : {}),
      ...(searchEngine ? { search: { queries: searchEngine.queries } } : {}),
      ...(pageServer ? { pages: { url: pageServer.url } } : {}),
      navigations,
      engineRequests,
      output,
      close,
    };
  } catch (error) {
    await close();
    throw new Error(`The app did not start.\n${output()}`, { cause: error });
  }
}

export const test = base.extend<{ launch: (options?: LaunchOptions) => Promise<LaunchedApp> }>({
  // Playwright reads the fixtures a fixture needs from this pattern: none here.
  launch: async ({}, use, testInfo) => {
    const launched: LaunchedApp[] = [];
    await use(async (options) => {
      const one = await launchApp(options);
      launched.push(one);
      return one;
    });
    for (const one of launched) {
      if (testInfo.status !== testInfo.expectedStatus) {
        // What the app said, and what its window showed: read them before guessing.
        console.error(`--- what the app wrote ---\n${one.output().slice(-6_000)}`);
        await testInfo.attach('app-output.txt', { body: one.output(), contentType: 'text/plain' });
        const picture = testInfo.outputPath('window.png');
        const taken = await one.page.screenshot({ path: picture, timeout: 5_000 }).then(
          () => true,
          () => false,
        );
        if (taken) await testInfo.attach('window.png', { path: picture, contentType: 'image/png' });
      }
      await one.close();
    }
    // A data folder kept for a later launch goes at the end of the test.
    for (const dir of new Set(launched.map((one) => one.dataDir))) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      await rm(`${dir}-home`, { recursive: true, force: true }).catch(() => undefined);
    }
  },
});

export { expect } from '@playwright/test';

/** A search engine shaped as DuckDuckGo's HTML page (task 10.4), on this machine: what it was asked. */
async function startFakeSearchEngine(options: NonNullable<LaunchOptions['search']>): Promise<{ url: string; queries: string[]; close(): Promise<void> }> {
  const queries: string[] = [];
  const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/html/') {
      res.writeHead(404);
      res.end();
      return;
    }
    queries.push(url.searchParams.get('q') ?? '');
    const body = options.blocked
      ? '<form id="challenge-form"></form>'
      : (options.results ?? [])
          .map(
            (result) =>
              `<div class="result"><a class="result__a" href="${escape(result.href)}">${escape(result.title)}</a><a class="result__snippet">${escape(result.snippet)}</a></div>`,
          )
          .join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>${body}</body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    queries,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Pages for the built-in browser (task 10.1), served on this machine as a dev server would. */
async function startPageServer(pages: Record<string, string>): Promise<{ url: string; close(): Promise<void> }> {
  const server = createHttpServer((req, res) => {
    const page = pages[new URL(req.url ?? '/', 'http://127.0.0.1').pathname];
    if (page === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
