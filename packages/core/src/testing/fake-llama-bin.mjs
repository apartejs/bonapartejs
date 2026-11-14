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

import { startFakeLlamaServer } from './fake-llama-server.ts';

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

const nCtx = integer('-c', '--ctx-size');
const slots = integer('-np', '--parallel');
const slotDir = value('--slot-save-path');

try {
  const server = await startFakeLlamaServer({
    port,
    apiKey: key,
    modelPath: value('-m', '--model') ?? '',
    ...(nCtx !== undefined && nCtx > 0 ? { nCtx } : {}),
    ...(slots !== undefined && slots > 0 ? { totalSlots: slots } : {}),
    ...(slotDir !== undefined ? { slotDir } : {}),
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
