/**
 * The window asks the engine three things through the bridge: its state,
 * the models it found, and to load one. A load that fails comes back as a
 * typed error the window says in its own words — never as an exception whose
 * message is the protocol's English.
 */

import {
  EngineStoppedError,
  ModelNotListedError,
  UnsupportedFamilyError,
  type Core,
  type EngineState,
} from '@aparte/bonaparte-core';
import { describe, expect, it } from 'vitest';
import { createIpcRegistry, type IpcMainLike } from './register.js';
import { registerEngineChannels } from './engine.js';

type Listener = Parameters<IpcMainLike['handle']>[1];
const ours = 'bonaparte://app/index.html';

const READY: EngineState = {
  mode: 'managed',
  status: 'ready',
  model: { path: 'C:\\models\\gemma.gguf', name: 'gemma', family: 'gemma', nCtx: 8192 },
};

function setup(loadModel: Core['loadModel']) {
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainLike = { handle: (name, listener) => void listeners.set(name, listener) };
  const ipc = createIpcRegistry({ ipcMain, isTrusted: (url) => url.startsWith('bonaparte://app/') });
  const core = {
    engineState: async () => ({ mode: 'managed', status: 'stopped' }) as EngineState,
    models: async () => [],
    loadModel,
  } as unknown as Core;
  registerEngineChannels(ipc, core);
  const call = (name: string, input: unknown) => listeners.get(name)!({ senderFrame: { url: ours } }, input);
  return { call };
}

describe('the engine channels', () => {
  it('give the state of the engine and the models found', async () => {
    const { call } = setup(async () => READY);
    await expect(call('engine.state', undefined)).resolves.toEqual({ mode: 'managed', status: 'stopped' });
    await expect(call('engine.models', undefined)).resolves.toEqual([]);
  });

  it('load a model, and give the state it left the engine in', async () => {
    const loaded: string[] = [];
    const { call } = setup(async (path) => {
      loaded.push(path);
      return READY;
    });
    await expect(call('engine.load', { path: 'C:\\models\\gemma.gguf' })).resolves.toEqual({ ok: true, state: READY });
    expect(loaded).toEqual(['C:\\models\\gemma.gguf']);
  });

  it('turn each failure of a load into a code the window says in its own words', async () => {
    const failing = (error: Error) => setup(async () => Promise.reject(error)).call;
    await expect(failing(new ModelNotListedError('x.gguf'))('engine.load', { path: 'x.gguf' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'not-listed' },
    });
    await expect(failing(new UnsupportedFamilyError('no-chat-template'))('engine.load', { path: 'x.gguf' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'no-chat-template' },
    });
    await expect(failing(new UnsupportedFamilyError('unsupported-family'))('engine.load', { path: 'x.gguf' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'unsupported-family' },
    });
    const failed = await failing(new Error('llama-server stopped before it was ready.\nerror: out of memory'))('engine.load', {
      path: 'x.gguf',
    });
    expect(failed).toMatchObject({ ok: false, error: { code: 'failed', detail: expect.stringContaining('out of memory') } });
  });

  it('give the lines of an engine that stopped, without our own sentence around them', async () => {
    const call = setup(async () => Promise.reject(new EngineStoppedError('error: out of memory'))).call;
    await expect(call('engine.load', { path: 'x.gguf' })).resolves.toEqual({
      ok: false,
      error: { code: 'failed', detail: 'error: out of memory' },
    });
  });

  it('refuse a load whose path is not a string, before the core hears of it', async () => {
    const { call } = setup(async () => READY);
    await expect(call('engine.load', { path: 42 })).rejects.toThrow(/input/);
    await expect(call('engine.load', { path: '' })).rejects.toThrow(/input/);
  });
});
