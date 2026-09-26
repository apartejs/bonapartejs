/**
 * REAL SMOKE — the agentic path against a real llama-server.
 *
 * This file does NOT run in CI: it's skipped as long as
 * `BONAPARTE_SMOKE_MODEL` isn't set. It exists because three things can't
 * be proven against the fake server:
 *
 * 1. The **lazy grammar** (`grammar_lazy` + `grammar_triggers` +
 *    `preserved_tokens`) is documented nowhere in llama.cpp's README —
 *    only in `tools/server/server-schema.cpp`. A real server is the only
 *    judge of whether it accepts them.
 * 2. That a real model actually emits Hermes `<tool_call>` with OUR prompt.
 * 3. That the KV cache prefix **survives a tool round-trip** — the
 *    differentiator under agentic load, never measured.
 *
 * Usage (PowerShell):
 *   $env:BONAPARTE_SMOKE_MODEL="D:\models\qwen.gguf"
 *   npx vitest run src/smoke
 *
 * Variables: BONAPARTE_SMOKE_MODEL (required, GGUF path) ·
 * BONAPARTE_SMOKE_LLAMA (default "llama") · BONAPARTE_SMOKE_CTX (default 8192).
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentEvent } from '../agent/loop.js';
import {
  createLlamaCppBackend,
  detectServeCommandPrefix,
  type ProcessHandle,
} from '../backend/llamacpp/llamacpp-backend.js';
import type { Backend } from '../backend/types.js';
import { ConversationStore } from '../conversation/store.js';
import { fingerprintModelFile } from '../kv/fingerprint.js';
import { KvStore, type LiveBackendConfig } from '../kv/kv-store.js';
import { PermissionEngine } from '../permissions/engine.js';
import { ChatSession, type ChatSessionOptions } from '../session/chat-session.js';
import { builtinTools } from '../tools/builtin/index.js';
import { ToolRegistry } from '../tools/registry.js';

const MODEL = process.env['BONAPARTE_SMOKE_MODEL'];
const LLAMA = process.env['BONAPARTE_SMOKE_LLAMA'] ?? 'llama';
const N_CTX = Number(process.env['BONAPARTE_SMOKE_CTX'] ?? 8192);
const PORT = 8127;

/** Password stashed in a file: the model can NOT make it up. */
const SECRET = 'ORANGE-42-VERMILLON';

/** One minute of margin per turn: a big model takes its time on the first one. */
const TURN_TIMEOUT_MS = 900_000;

/**
 * Anti-orphan safety net. `afterAll` isn't enough: a Ctrl-C at the wrong
 * moment, a vitest crash, and the server — hence the model in VRAM —
 * survives the test. We keep a handle on the child and take it down from
 * every process exit path, including `exit` (which only allows
 * synchronous work — our kill is, by construction).
 */
let spawned: ProcessHandle | null = null;
let guardsInstalled = false;

function installExitGuards(): void {
  if (guardsInstalled) return;
  guardsInstalled = true;
  const killNow = (): void => {
    const handle = spawned;
    spawned = null;
    handle?.kill();
  };
  process.on('exit', killNow);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      killNow();
      // We intercepted the signal: it's on us to exit now, otherwise
      // Ctrl-C would have no effect anymore.
      process.exit(130);
    });
  }
}

function spawnServer(binPath: string, args: string[], env?: Record<string, string>): ProcessHandle {
  const child = spawn(binPath, args, {
    // The API key travels here: dropping it would launch an open server
    // and prove nothing about the key.
    ...(env ? { env: { ...process.env, ...env } } : {}),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    ...(process.platform === 'win32' ? {} : { detached: true }),
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString('utf8').trimEnd();
    // Only what matters: the rest would drown out the verdict.
    if (/error|failed|invalid|unknown argument/i.test(line)) console.log(`[llama] ${line}`);
  });
  const handle: ProcessHandle = {
    onExit: (cb) => {
      child.on('exit', (code) => {
        spawned = null;
        cb(code);
      });
    },
    kill: () => {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          timeout: 5_000,
        });
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill();
        }
      }
      spawned = null;
    },
  };

  spawned = handle;
  installExitGuards();
  return handle;
}

interface Collected {
  events: AgentEvent[];
  text: string;
  calls: string[];
  results: { name: string; ok: boolean }[];
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<Collected> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return {
    events,
    text: events
      .filter((e): e is Extract<AgentEvent, { type: 'token' }> => e.type === 'token')
      .map((e) => e.text)
      .join(''),
    calls: events
      .filter((e): e is Extract<AgentEvent, { type: 'tool_call' }> => e.type === 'tool_call')
      .map((e) => e.name),
    results: events
      .filter((e): e is Extract<AgentEvent, { type: 'tool_result' }> => e.type === 'tool_result')
      .map((e) => ({ name: e.name, ok: e.ok })),
  };
}

function turnEnd(events: AgentEvent[]): Extract<AgentEvent, { type: 'turn_end' }> | undefined {
  return events.find(
    (e): e is Extract<AgentEvent, { type: 'turn_end' }> => e.type === 'turn_end',
  );
}

describe.skipIf(!MODEL)('REAL SMOKE — agentic path', () => {
  let backend: Backend;
  let base: Omit<ChatSessionOptions, 'live'> & { live: LiveBackendConfig };

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'bonaparte-smoke-'));
    const projectRoot = join(root, 'project');
    const slotDir = join(root, 'slots');
    await mkdir(projectRoot, { recursive: true });
    await mkdir(slotDir, { recursive: true });
    await writeFile(
      join(projectRoot, 'notes.txt'),
      `Internal report.\nThe password is ${SECRET}.\nEnd of report.\n`,
      'utf8',
    );

    const registry = new ToolRegistry();
    for (const tool of builtinTools()) registry.register(tool.def, tool.handler, 'builtin');

    backend = createLlamaCppBackend({
      mode: 'managed',
      binPath: LLAMA,
      spawnFn: spawnServer,
      commandPrefix: detectServeCommandPrefix(LLAMA),
      launch: {
        modelPath: MODEL as string,
        port: PORT,
        nCtx: N_CTX,
        cacheTypeK: 'f16',
        cacheTypeV: 'f16',
        slotSavePath: slotDir,
        parallelSlots: 1,
      },
    });
    await backend.start();

    base = {
      backend,
      kv: new KvStore(slotDir),
      store: new ConversationStore(join(root, 'conversations')),
      registry,
      permissions: new PermissionEngine('impro'),
      roots: [projectRoot],
      // A small model at default temperature is a coin flip on protocol
      // details (the first run answered with a ```json fence instead of the
      // <tool_call> tags, the next one with the tags). The smoke judges the
      // harness, not the dice: low temperature, fixed seed.
      sampling: { temperature: 0.2, seed: 42 },
      live: {
        modelFingerprint: await fingerprintModelFile(MODEL as string),
        nCtx: N_CTX,
        cacheTypeK: 'f16',
        cacheTypeV: 'f16',
        // The manifest requires an exact match; 'unknown' only matches
        // 'unknown', which is enough for a round trip within a single run.
        buildTag: 'unknown',
      },
    };
  }, TURN_TIMEOUT_MS);

  afterAll(async () => {
    await backend?.stop().catch(() => undefined);
  });

  it(
    'the real server refuses a request without our key (--api-key via LLAMA_API_KEY)',
    async () => {
      const bare = await fetch(`http://127.0.0.1:${PORT}/props`);
      console.log(`[smoke] /props without the key: HTTP ${bare.status}`);
      expect(bare.status).toBe(401);
      // …while the backend, which holds the key, reads it.
      await expect(backend.props()).resolves.toMatchObject({ modelPath: expect.any(String) });
    },
    TURN_TIMEOUT_MS,
  );

  it(
    'calls a real tool and uses its result',
    async () => {
      const { session } = await ChatSession.open(base, 'smoke-outil');

      // The tool is named on purpose: the smoke judges the harness's path
      // (call → execution → result → answer), not a small model's agency.
      // Asked only to "tell the password", Qwen3-1.7B invents one.
      const out = await collect(
        session.send(
          'Use the read_file tool on notes.txt and tell me the password it contains. ' +
            'Answer with the password itself.',
        ),
      );

      console.log(`[smoke] tools called: ${out.calls.join(', ') || '(none)'}`);
      console.log(`[smoke] response: ${out.text.trim().slice(0, 200)}`);

      // 1. The model emitted Hermes that OUR parser was able to read.
      expect(out.calls.length).toBeGreaterThan(0);
      // 2. The tool ran inside the project, without failing.
      expect(out.results.some((r) => r.ok)).toBe(true);
      // 3. The result made it back to the model, which used it: this word
      //    cannot be guessed, it only exists in the file.
      expect(out.text).toContain(SECRET);
    },
    TURN_TIMEOUT_MS,
  );

  it(
    'does NOT force a call when the question does not ask for one (lazy grammar)',
    async () => {
      // Without `grammar_lazy`, the grammar would force EVERY turn to
      // produce a tool call. This is the only test that proves these
      // undocumented parameters do what we think they do.
      const { session } = await ChatSession.open(base, 'smoke-paresse');

      const out = await collect(
        session.send('Reply with exactly the word PONG. Do not use any tool.'),
      );

      console.log(`[smoke] tools called: ${out.calls.join(', ') || '(none)'}`);
      console.log(`[smoke] response: ${out.text.trim().slice(0, 120)}`);

      expect(out.calls).toEqual([]);
      expect(out.text.toUpperCase()).toContain('PONG');
    },
    TURN_TIMEOUT_MS,
  );

  it(
    'keeps the cache prefix after a tool round-trip',
    async () => {
      const { session } = await ChatSession.open(base, 'smoke-cache');

      // Turn 1: a tool call, so several exchanges with the model.
      const first = await collect(
        session.send('Read notes.txt and summarise it in one short sentence.'),
      );
      expect(first.calls.length).toBeGreaterThan(0);

      // Turn 2: turn 1's prompt (tool result included) must be served from
      // the cache. A prefix broken by the reinjection collapses to zero.
      const second = await collect(session.send('Now answer in exactly one word: OK.'));
      const stats = turnEnd(second.events);
      expect(stats).toBeDefined();

      console.log(`[smoke] tokens served from cache on turn 2: ${stats?.cachedTokens}`);
      console.log(`[smoke] turn 2 prefill: ${stats?.promptMs} ms`);

      expect(stats?.cachedTokens ?? 0).toBeGreaterThan(0);
    },
    TURN_TIMEOUT_MS,
  );

  it(
    'saves then restores a KV state containing tool turns',
    async () => {
      const { session } = await ChatSession.open(base, 'smoke-restore');

      // Word for word the prompt of the first case: with a fixed seed, the
      // same tokens give the same call — one phrasing verified, reused.
      const first = await collect(
        session.send(
          'Use the read_file tool on notes.txt and tell me the password it contains. ' +
            'Answer with the password itself.',
        ),
      );
      expect(first.calls.length).toBeGreaterThan(0);

      expect(await session.save()).toBe(true);

      // Reopening: the exact path of a conversation resumed after the app
      // closes, with a history that contains tools.
      const reopened = await ChatSession.open(base, 'smoke-restore');
      console.log(`[smoke] restore: ${JSON.stringify(reopened.restore)}`);
      expect(reopened.restore.restored).toBe(true);

      // The model must still have the secret in context without rereading
      // the file: proof that the restored state carries the tool history.
      const after = await collect(
        reopened.session.send('Repeat the password you found earlier, nothing else.'),
      );
      console.log(`[smoke] after restore: ${after.text.trim().slice(0, 120)}`);
      expect(after.text).toContain(SECRET);
    },
    TURN_TIMEOUT_MS,
  );

  it(
    'a restored state serves as the prefix of a longer, different prompt',
    async () => {
      // Prefix seeds and branching both rest on this single property, and
      // the fake server cannot prove it (it simulates a proportional
      // prefill): restore the state saved from conversation A, then send a
      // prompt that shares A's turns and diverges after them. llama-server's
      // cache_prompt keeps the longest common token prefix, so the cached
      // count must cover (nearly) everything A had saved.
      const { session: a } = await ChatSession.open(base, 'smoke-seed-a');
      const first = await collect(
        a.send('Reply with exactly the word ALPHA. Do not use any tool.'),
      );
      expect(first.text.toUpperCase()).toContain('ALPHA');
      expect(await a.save()).toBe(true);
      const manifest = JSON.parse(
        await readFile(join(base.kv.manifestDir, 'smoke-seed-a.manifest.json'), 'utf8'),
      ) as { promptTokenCount: number };
      console.log(`[smoke] A saved: ${manifest.promptTokenCount} tokens`);

      // Pollute the live slot with another conversation that shares only the
      // system prompt: whatever the branch gets from the cache afterwards
      // comes from the RESTORED state, not from the slot's leftovers.
      const { session: other } = await ChatSession.open(base, 'smoke-seed-other');
      await collect(other.send('Reply with exactly the word OMEGA. Do not use any tool.'));

      // Branch B: A's turns copied, then a different next turn. B has no
      // state of its own — the prefix must come from A's restored file.
      const { store } = base;
      await store.create('smoke-seed-b');
      for (const event of await store.loadEvents('smoke-seed-a')) {
        await store.appendEvent('smoke-seed-b', event);
      }
      // B opens first: a fresh conversation restores (or prepares) the shared
      // prefix seed on open — the state restored LAST is the one the slot
      // holds. Then A's state, explicitly: that is what a branch will do
      // inside its own open, once branching exists.
      const { session: b } = await ChatSession.open(base, 'smoke-seed-b');
      const restored = await base.kv.restoreState(backend.slots!, 0, 'smoke-seed-a', base.live);
      expect(restored.restored).toBe(true);

      const out = await collect(
        b.send('Now reply with exactly the word BRAVO. Do not use any tool.'),
      );
      const stats = turnEnd(out.events);
      console.log(
        `[smoke] branch: ${stats?.cachedTokens} tokens served from A's restored state ` +
          `(A had saved ${manifest.promptTokenCount})`,
      );
      expect(out.text.toUpperCase()).toContain('BRAVO');
      expect(stats?.cachedTokens ?? 0).toBeGreaterThanOrEqual(
        Math.floor(manifest.promptTokenCount * 0.9),
      );
    },
    TURN_TIMEOUT_MS,
  );

  it(
    'the seed prepared by one fresh conversation serves the next one from the cache',
    async () => {
      // Prefix seeds (D-75): a fresh conversation prefills its system block
      // once and saves it; the next fresh one restores that seed and its
      // first turn is served from the cache. Two ids nobody opened before.
      const one = await ChatSession.open(base, 'smoke-seed-fresh-one');
      console.log(`[smoke] seed, first open: ${JSON.stringify(one.seed)}`);
      // A seed may already exist from the earlier cases (same prefix): either
      // it was restored, or it was just created — never nothing.
      expect(one.seed).toBeDefined();
      expect(one.seed?.restored || (one.seed && 'created' in one.seed && one.seed.created)).toBe(true);

      const two = await ChatSession.open(base, 'smoke-seed-fresh-two');
      console.log(`[smoke] seed, second open: ${JSON.stringify(two.seed)}`);
      expect(two.seed?.restored).toBe(true);
      const seeded = two.seed?.restored ? two.seed.nRestored : 0;
      expect(seeded).toBeGreaterThan(0);

      const out = await collect(
        two.session.send('Reply with exactly the word DELTA. Do not use any tool.'),
      );
      const stats = turnEnd(out.events);
      console.log(
        `[smoke] seeded first turn: ${stats?.cachedTokens} tokens served from the seed ` +
          `(the seed holds ${seeded}), prefill ${stats?.promptMs} ms`,
      );
      expect(out.text.toUpperCase()).toContain('DELTA');
      // The server samples one token on n_predict 0 and the prefix match
      // drops it: everything up to it must come from the cache.
      expect(stats?.cachedTokens ?? 0).toBeGreaterThanOrEqual(seeded - 1);
    },
    TURN_TIMEOUT_MS,
  );
});
