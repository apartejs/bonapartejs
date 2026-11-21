/**
 * Who holds the engine (audit C1). With one slot, a turn keeps it while its
 * tools run: a conversation that waits for it says who holds it and what it
 * does — « Attend le moteur : « Refonte du login » lance pnpm test » —, said
 * again each time that changes; the engine's card reads the same holders.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamRunEvent } from '@aparte/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { runAgentTurn } from '../agent/loop.js';
import { turnEventToWire } from '../agent/wire.js';
import { LlamaCppHttpClient } from '../backend/llamacpp/http-client.js';
import { familyLayer } from '../families/index.js';
import { KvStore, type LiveConfig } from '../kv/kv-store.js';
import { PermissionEngine } from '../permissions/engine.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { ToolRegistry } from '../tools/registry.js';
import { callTarget, ConversationEngine, type SlotHolder, type TurnEvent } from './engine.js';
import { ConversationStore } from './store.js';

let servers: FakeLlamaServer[] = [];
let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
  servers = [];
  dirs = [];
});

const Q = '<|"|>';
const LIVE: LiveConfig = { modelFingerprint: 'fp-gemma', nCtx: 8192, cacheTypeK: 'f16', cacheTypeV: 'f16' };
const answered = (prompt: string) => prompt.lastIndexOf('<|tool_response>') > prompt.lastIndexOf('<|turn>user');
const RUN_TESTS = `<|tool_call>call:run_command{program:${Q}pnpm${Q},args:[${Q}test${Q}]}<tool_call|>`;

async function rig() {
  const dir = await mkdtemp(join(tmpdir(), 'bp-holder-'));
  dirs.push(dir);
  const root = join(dir, 'project');
  await mkdir(root, { recursive: true });
  const server = await startFakeLlamaServer({
    slotDir: join(dir, 'kv-slots'),
    paceMs: 5,
    // The login conversation runs the tests, then answers; any other answers at once.
    responder: (prompt) => (prompt.includes('Refais le login') && !answered(prompt) ? RUN_TESTS : 'Fait.'),
  });
  servers.push(server);
  const client = new LlamaCppHttpClient(server.url);
  const store = new ConversationStore(join(dir, 'conversations'));
  // A command that runs until the test lets it end.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  const registry = new ToolRegistry();
  registry.register(
    {
      name: 'run_command',
      description: 'Runs a program.',
      inputSchema: { type: 'object', properties: { program: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } } },
      effect: 'execute',
      source: 'builtin',
      where: 'core',
    },
    async () => {
      started();
      await released;
      return { content: 'ok' };
    },
  );
  const engine = new ConversationEngine({
    store,
    kv: new KvStore(join(dir, 'kv-slots')),
    engine: async () => ({ client, family: familyLayer('gemma'), live: LIVE, modelPath: 'gemma.gguf', kvBytesPerToken: 100, generation: 1 }),
    prompt: () => ({ kind: 'code', tools: registry.list(), perimeter: [root], replyLanguage: 'French' }),
  });
  const permissions = new PermissionEngine({ roots: () => [root], dataDir: join(dir, 'data') });
  const run = (conversationId: string, text: string, said: TurnEvent[] = [], wire: StreamRunEvent[] = []) =>
    runAgentTurn(
      {
        conversationId,
        input: { text },
        mode: 'impro',
        registry,
        permissions,
        conversations: engine,
        roots: [root],
        nCtx: 8192,
        ticket: (pending) => `ticket-${pending.length}`,
        signal: new AbortController().signal,
      },
      (event) => wire.push(event),
      (event) => {
        said.push(event);
        wire.push(...turnEventToWire(event, { on: false }));
      },
    );
  return { store, engine, run, running, release };
}

const waits = (said: TurnEvent[]) =>
  said.filter((event): event is Extract<TurnEvent, { type: 'step' }> => event.type === 'step' && event.name === 'slot-wait');

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('who holds the engine (audit C1)', () => {
  it('a conversation that waits for the slot says who holds it and what it does, and again when that changes', async () => {
    const { store, engine, run, running, release } = await rig();
    const login = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'impro' });
    await store.rename(login.id, 'Refonte du login');
    const other = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'impro' });

    const first = run(login.id, 'Refais le login.');
    await running;
    const tests: SlotHolder = {
      conversationId: login.id,
      title: 'Refonte du login',
      doing: { kind: 'tool', tool: 'run_command', target: 'pnpm test' },
    };
    // The card reads it too.
    expect(engine.holders).toEqual([tests]);

    const said: TurnEvent[] = [];
    const wire: StreamRunEvent[] = [];
    const second = run(other.id, 'Et toi ?', said, wire);
    await until(() => waits(said).length > 0);
    expect(waits(said)[0]).toEqual({ type: 'step', name: 'slot-wait', phase: 'start', holder: tests });
    // On the wire, the step carries it for the window.
    expect(wire.find((event) => event.type === 'step-start')).toMatchObject({ name: 'slot-wait', holder: tests });

    release();
    await Promise.all([first, second]);
    // The tests done, the login conversation answers: said again, then the wait ends.
    expect(waits(said).map((step) => [step.phase, step.holder?.doing.kind])).toEqual([
      ['start', 'tool'],
      ['end', undefined],
      ['start', 'answer'],
      ['end', undefined],
    ]);
    expect(engine.holders).toEqual([]);
  });

  it('a turn that finds the slot free says no wait', async () => {
    const { store, run } = await rig();
    const alone = await store.create({ kind: 'code', engineId: 'builtin', modelId: 'gemma', mode: 'impro' });
    const said: TurnEvent[] = [];
    await run(alone.id, 'Bonjour.', said);
    expect(waits(said)).toEqual([]);
  });

  it('a call is said by its target, short: the command and its arguments, a path, an address', () => {
    expect(callTarget('run_command', { program: 'pnpm', args: ['test', '--filter', 'core'] })).toBe('pnpm test --filter core');
    expect(callTarget('run_command', { program: 'C:\\Program Files\\nodejs\\node.exe', args: ['-v'] })).toBe('node.exe -v');
    expect(callTarget('read_file', { path: 'src/a.ts' })).toBe('src/a.ts');
    expect(callTarget('web_fetch', { url: 'https://example.com' })).toBe('https://example.com');
    expect(callTarget('run_subagent', { name: 'Lecteur', mission: 'Lis.' })).toBe('Lecteur');
    expect(callTarget('update_plan', {})).toBeUndefined();
    // A search is said by what it looks for, not the folder it looks in (review of C1).
    expect(callTarget('search', { pattern: 'hours =', path: 'src' })).toBe('hours =');
    expect(callTarget('run_command', { program: 'node', args: ['x'.repeat(100)] })!.length).toBe(60);
  });
});
