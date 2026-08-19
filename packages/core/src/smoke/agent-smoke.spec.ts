/**
 * SMOKE RÉEL — le chemin agentique contre un vrai llama-server.
 *
 * Ce fichier ne tourne PAS en CI : il se saute tant que `BONAPARTE_SMOKE_MODEL`
 * n'est pas défini. Il existe parce que trois choses ne peuvent pas être
 * prouvées contre le faux serveur :
 *
 * 1. La **grammaire paresseuse** (`grammar_lazy` + `grammar_triggers` +
 *    `preserved_tokens`) n'est documentée nulle part dans le README de
 *    llama.cpp — seulement dans `tools/server/server-schema.cpp`. Un vrai
 *    serveur est le seul juge de leur acceptation.
 * 2. Qu'un vrai modèle émette bien du Hermes `<tool_call>` avec NOTRE prompt.
 * 3. Que le préfixe du cache KV **survive à un aller-retour d'outil** — le
 *    différenciateur sous charge agentique, jamais mesuré.
 *
 * Usage (PowerShell) :
 *   $env:BONAPARTE_SMOKE_MODEL="D:\modeles\qwen.gguf"
 *   npx vitest run src/smoke
 *
 * Variables : BONAPARTE_SMOKE_MODEL (requis, chemin GGUF) ·
 * BONAPARTE_SMOKE_LLAMA (défaut « llama ») · BONAPARTE_SMOKE_CTX (défaut 8192).
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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

/** Mot de passe planqué dans un fichier : le modèle ne peut PAS l'inventer. */
const SECRET = 'ORANGE-42-VERMILLON';

/** Une minute de marge par tour : un gros modèle prend son temps au premier. */
const TURN_TIMEOUT_MS = 900_000;

function spawnServer(binPath: string, args: string[]): ProcessHandle {
  const child = spawn(binPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    ...(process.platform === 'win32' ? {} : { detached: true }),
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString('utf8').trimEnd();
    // Seulement ce qui compte : le reste noierait le verdict.
    if (/error|failed|invalid|unknown argument/i.test(line)) console.log(`[llama] ${line}`);
  });
  return {
    onExit: (cb) => {
      child.on('exit', (code) => cb(code));
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
    },
  };
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

describe.skipIf(!MODEL)('SMOKE RÉEL — chemin agentique', () => {
  let backend: Backend;
  let base: Omit<ChatSessionOptions, 'live'> & { live: LiveBackendConfig };

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'bonaparte-smoke-'));
    const projectRoot = join(root, 'projet');
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
      projectRoot,
      live: {
        modelFingerprint: await fingerprintModelFile(MODEL as string),
        nCtx: N_CTX,
        cacheTypeK: 'f16',
        cacheTypeV: 'f16',
        // Le manifest exige un match exact ; 'unknown' ne matche que 'unknown',
        // ce qui suffit pour un aller-retour dans une même exécution.
        buildTag: 'unknown',
      },
    };
  }, TURN_TIMEOUT_MS);

  afterAll(async () => {
    await backend?.stop().catch(() => undefined);
  });

  it(
    'appelle un outil réel et se sert du résultat',
    async () => {
      const { session } = await ChatSession.open(base, 'smoke-outil');

      const out = await collect(
        session.send(
          'Read the file notes.txt in the project and tell me the password it contains. ' +
            'Answer with the password itself.',
        ),
      );

      console.log(`[smoke] outils appelés : ${out.calls.join(', ') || '(aucun)'}`);
      console.log(`[smoke] réponse : ${out.text.trim().slice(0, 200)}`);

      // 1. Le modèle a émis du Hermes que NOTRE parser a su lire.
      expect(out.calls.length).toBeGreaterThan(0);
      // 2. L'outil a tourné dans le projet, sans échouer.
      expect(out.results.some((r) => r.ok)).toBe(true);
      // 3. Le résultat est revenu au modèle, qui s'en est servi : ce mot ne
      //    peut pas être deviné, il n'existe que dans le fichier.
      expect(out.text).toContain(SECRET);
    },
    TURN_TIMEOUT_MS,
  );

  it(
    'ne force PAS un appel quand la question n’en demande pas (grammaire paresseuse)',
    async () => {
      // Sans `grammar_lazy`, la grammaire contraindrait CHAQUE tour à produire
      // un appel d'outil. C'est le seul test qui prouve que ces paramètres non
      // documentés font ce qu'on croit.
      const { session } = await ChatSession.open(base, 'smoke-paresse');

      const out = await collect(
        session.send('Reply with exactly the word PONG. Do not use any tool.'),
      );

      console.log(`[smoke] outils appelés : ${out.calls.join(', ') || '(aucun)'}`);
      console.log(`[smoke] réponse : ${out.text.trim().slice(0, 120)}`);

      expect(out.calls).toEqual([]);
      expect(out.text.toUpperCase()).toContain('PONG');
    },
    TURN_TIMEOUT_MS,
  );

  it(
    'garde le préfixe du cache après un aller-retour d’outil',
    async () => {
      const { session } = await ChatSession.open(base, 'smoke-cache');

      // Tour 1 : appel d'outil, donc plusieurs échanges avec le modèle.
      const first = await collect(
        session.send('Read notes.txt and summarise it in one short sentence.'),
      );
      expect(first.calls.length).toBeGreaterThan(0);

      // Tour 2 : le prompt du tour 1 (résultat d'outil compris) doit être servi
      // par le cache. Un préfixe cassé par la réinjection s'effondre vers zéro.
      const second = await collect(session.send('Now answer in exactly one word: OK.'));
      const stats = turnEnd(second.events);
      expect(stats).toBeDefined();

      console.log(`[smoke] tokens servis par le cache au tour 2 : ${stats?.cachedTokens}`);
      console.log(`[smoke] prefill du tour 2 : ${stats?.promptMs} ms`);

      expect(stats?.cachedTokens ?? 0).toBeGreaterThan(0);
    },
    TURN_TIMEOUT_MS,
  );

  it(
    'sauvegarde puis restaure un état KV contenant des tours d’outil',
    async () => {
      const { session } = await ChatSession.open(base, 'smoke-restore');

      const first = await collect(
        session.send('Read notes.txt and tell me the password. Answer with the password only.'),
      );
      expect(first.calls.length).toBeGreaterThan(0);

      expect(await session.save()).toBe(true);

      // Réouverture : le chemin exact d'une conversation reprise après
      // fermeture de l'app, avec un historique qui contient des outils.
      const reopened = await ChatSession.open(base, 'smoke-restore');
      console.log(`[smoke] restore : ${JSON.stringify(reopened.restore)}`);
      expect(reopened.restore.restored).toBe(true);

      // Le modèle doit encore avoir le secret en contexte sans relire le
      // fichier : preuve que l'état restauré porte l'historique d'outil.
      const after = await collect(
        reopened.session.send('Repeat the password you found earlier, nothing else.'),
      );
      console.log(`[smoke] après restore : ${after.text.trim().slice(0, 120)}`);
      expect(after.text).toContain(SECRET);
    },
    TURN_TIMEOUT_MS,
  );
});
