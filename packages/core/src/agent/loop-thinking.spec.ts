import { afterEach, describe, expect, it } from 'vitest';
import { createLlamaCppBackend } from '../backend/llamacpp/llamacpp-backend.js';
import type { TranscriptEntry } from '../backend/types.js';
import { PermissionEngine } from '../permissions/engine.js';
import { startFakeLlamaServer, type FakeLlamaServer } from '../testing/fake-llama-server.js';
import { ToolRegistry } from '../tools/registry.js';
import { AgentLoop } from './loop.js';

// The loop carries the conversation's reasoning switch down to the backend:
// off means an empty think block in the generation suffix, on (the default)
// leaves the model free to reason.

let servers: FakeLlamaServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});

async function promptFor(thinking: boolean | undefined): Promise<string> {
  let captured = '';
  const server = await startFakeLlamaServer({
    responder: (prompt) => {
      captured = prompt;
      return 'ok';
    },
  });
  servers.push(server);
  const backend = createLlamaCppBackend({ mode: 'remote', url: server.url });
  await backend.start();
  const loop = new AgentLoop({
    backend,
    registry: new ToolRegistry(),
    permissions: new PermissionEngine('impro'),
    conversationId: 'conv-think',
    system: {},
    ...(thinking === undefined ? {} : { thinking }),
  });
  const transcript: TranscriptEntry[] = [];
  for await (const _event of loop.run(transcript, 'hi', new AbortController().signal)) {
    /* drain */
  }
  await backend.stop();
  return captured;
}

describe('AgentLoop — reasoning switch', () => {
  it('lets the model reason by default', async () => {
    expect(await promptFor(undefined)).toMatch(/<\|im_start\|>assistant\n$/);
  });

  it('forces an empty think block when the conversation turned reasoning off', async () => {
    expect(await promptFor(false)).toMatch(/<\|im_start\|>assistant\n<think>\n\n<\/think>\n\n$/);
  });
});
