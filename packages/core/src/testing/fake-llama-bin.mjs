#!/usr/bin/env node
/**
 * A stand-in for llama.cpp's server, for the tests and the end-to-end tests:
 * it takes llama-server's arguments (and the unified CLI's `serve` before
 * them), demands its per-launch key in `LLAMA_API_KEY` as the real server
 * does when bonaparte launches it, and serves the fake llama-server on the
 * port it was given. No model, no GPU.
 *
 * Node 24 runs the TypeScript of the fake server directly.
 */

import { appendFileSync } from 'node:fs';
import { fakeTokenize, startFakeLlamaServer } from './fake-llama-server.ts';

const args = process.argv.slice(2);
if (args[0] === 'serve') args.shift();

if (args.includes('--version')) {
  // The shape of the unified CLI's answer: a build number, then its commit.
  process.stdout.write('version: 9999 (fake)\nbuilt with a fake compiler for the tests\n');
  process.exit(0);
}

/** The value after a flag, or undefined. */
function value(...flags) {
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index !== -1 && index + 1 < args.length) return args[index + 1];
  }
  return undefined;
}

function integer(...flags) {
  const raw = value(...flags);
  if (raw === undefined) return undefined;
  const number = Number.parseInt(raw, 10);
  return Number.isInteger(number) ? number : undefined;
}

// A test can make the server fail the way a real one does: a message, then out.
const failure = process.env['FAKE_LLAMA_FAIL'];
if (failure) {
  process.stderr.write(`error: ${failure}\n`);
  process.exit(1);
}

const key = process.env['LLAMA_API_KEY'];
if (!key) {
  process.stderr.write('fake-llama-bin: no LLAMA_API_KEY in the environment: bonaparte always gives one.\n');
  process.exit(2);
}

const port = integer('--port');
if (port === undefined) {
  process.stderr.write('fake-llama-bin: --port is required.\n');
  process.exit(2);
}

/** A whole number from the environment, or undefined. */
function fromEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const number = Number.parseInt(raw, 10);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

// What an end-to-end test cannot set otherwise, the engine being another process:
// how fast it reads and writes, and a record of what it was asked.
const prefillBatch = fromEnv('FAKE_LLAMA_PREFILL_BATCH');
const prefillPaceMs = fromEnv('FAKE_LLAMA_PREFILL_PACE_MS');
const paceMs = fromEnv('FAKE_LLAMA_PACE_MS');
const requests = process.env['FAKE_LLAMA_REQUESTS'];

const nCtx = integer('-c', '--ctx-size');
const slots = integer('-np', '--parallel');
const slotDir = value('--slot-save-path');

try {
  const server = await startFakeLlamaServer({
    port,
    apiKey: key,
    modelPath: value('-m', '--model') ?? '',
    // FAKE_LLAMA_UNIFIED: one KV pool for every slot, as `--kv-unified` gives:
    // each slot then reports the whole context.
    ...(nCtx !== undefined && nCtx > 0
      ? { nCtx: process.env['FAKE_LLAMA_UNIFIED'] ? nCtx * (slots ?? 1) : nCtx }
      : {}),
    ...(slots !== undefined && slots > 0 ? { totalSlots: slots } : {}),
    ...(slotDir !== undefined ? { slotDir } : {}),
    ...(prefillBatch !== undefined ? { prefillBatch } : {}),
    ...(prefillPaceMs !== undefined ? { prefillPaceMs } : {}),
    ...(paceMs !== undefined ? { paceMs } : {}),
    // FAKE_LLAMA_REQUESTS: one line per completion asked, in that file — its prompt's length,
    // the tokens the server counts in it, and n_predict.
    ...(requests
      ? {
          onCompletion: (body) => {
            const prompt = typeof body['prompt'] === 'string' ? body['prompt'] : '';
            const nPredict = typeof body['n_predict'] === 'number' ? body['n_predict'] : null;
            const line = { promptChars: prompt.length, promptTokens: fakeTokenize(prompt).length, nPredict };
            appendFileSync(requests, `${JSON.stringify(line)}\n`);
          },
        }
      : {}),
  });
  // What the real server says once it is ready (and never the key).
  process.stderr.write(`main: server is listening on http://127.0.0.1:${server.port}\n`);
  // A test can make the server print its key, as a verbose build might.
  if (process.env['FAKE_LLAMA_ECHO']) process.stderr.write(`main: api key ${key}\n`);
  const stop = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch (error) {
  process.stderr.write(`fake-llama-bin: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
