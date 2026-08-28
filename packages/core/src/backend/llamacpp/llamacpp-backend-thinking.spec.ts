import { afterEach, describe, expect, it } from 'vitest';
import { startFakeLlamaServer, type FakeLlamaServer } from '../../testing/fake-llama-server.js';
import { createLlamaCppBackend } from './llamacpp-backend.js';

// Qwen3 decides whether to reason from the generation suffix alone: an
// assistant header followed by an EMPTY think block means "answer directly",
// a bare header lets the model open <think>. The choice never touches the
// frozen history, so it costs nothing in the KV cache — which is why it can
// be a per-conversation setting. Until now the backend rendered every turn
// with the empty block: reasoning was off, and nothing could turn it on.

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
  const events = backend.runTurn({
    conversationId: 'conv-think',
    system: {},
    tools: [],
    transcript: [{ role: 'user', text: 'hi' }],
    signal: new AbortController().signal,
    ...(thinking === undefined ? {} : { thinking }),
  });
  for await (const _event of events) {
    /* drain */
  }
  await backend.stop();
  return captured;
}

describe('runTurn — reasoning', () => {
  it('forces an empty think block when thinking is off', async () => {
    expect(await promptFor(false)).toMatch(/<\|im_start\|>assistant\n<think>\n\n<\/think>\n\n$/);
  });

  it('leaves the reasoning to the model when thinking is on', async () => {
    expect(await promptFor(true)).toMatch(/<\|im_start\|>assistant\n$/);
  });

  it('lets the model reason by default', async () => {
    expect(await promptFor(undefined)).toMatch(/<\|im_start\|>assistant\n$/);
  });
});
