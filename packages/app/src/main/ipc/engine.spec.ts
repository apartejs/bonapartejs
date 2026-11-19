/**
 * The window asks the engine three things through the bridge: its state,
 * the models it found, and to load one. A load that fails comes back as a
 * typed error the window says in its own words — never as an exception whose
 * message is the protocol's English.
 */

import {
  DigestMismatchError,
  EngineBusyError,
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

const LLAMA = {
  current: { source: 'path' as const, build: 'b10217' },
  latest: { build: 'b12383', bytes: 37_000_000 },
  check: 'done' as const,
  updateAvailable: true,
  installing: null,
};

function setup(
  loadModel: Core['loadModel'],
  llama: Partial<Pick<Core, 'llamaCpp' | 'installLlamaCpp' | 'recommendedModels' | 'downloadModel' | 'modelSwitch' | 'switchModel' | 'engineSettings' | 'restartCost' | 'applyEngineSettings'>> = {},
) {
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainLike = { handle: (name, listener) => void listeners.set(name, listener) };
  const ipc = createIpcRegistry({ ipcMain, isTrusted: (url) => url.startsWith('bonaparte://app/') });
  const core = {
    engineState: async () => ({ mode: 'managed', status: 'stopped' }) as EngineState,
    models: async () => [],
    loadModel,
    llamaCpp: async () => LLAMA,
    installLlamaCpp: async () => ({ ...LLAMA, current: { source: 'managed', build: 'b12383' }, updateAvailable: false }),
    ...llama,
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

  it('say why an engine that wrote nothing stopped: the Visual C++ runtime missing or too old, else its exit code', async () => {
    const stopped = (code: number) => setup(async () => Promise.reject(new EngineStoppedError('', code))).call('engine.load', { path: 'x.gguf' });
    await expect(stopped(0xc0000135)).resolves.toEqual({ ok: false, error: { code: 'missing-runtime', detail: '0xC0000135' } });
    await expect(stopped(-1073741511)).resolves.toEqual({ ok: false, error: { code: 'old-runtime', detail: '0xC0000139' } });
    // Never our own sentence shown as « what llama.cpp said ».
    await expect(stopped(3)).resolves.toEqual({ ok: false, error: { code: 'silent', detail: '0x3' } });
  });

  it('refuse a load whose path is not a string, before the core hears of it', async () => {
    const { call } = setup(async () => READY);
    await expect(call('engine.load', { path: 42 })).rejects.toThrow(/input/);
    await expect(call('engine.load', { path: '' })).rejects.toThrow(/input/);
  });

  it('say which llama.cpp runs, asking GitHub only when the window asks to', async () => {
    const asked: unknown[] = [];
    const { call } = setup(async () => READY, {
      llamaCpp: async (options) => {
        asked.push(options);
        return LLAMA;
      },
    });
    await expect(call('engine.llama', { checkLatest: true })).resolves.toEqual(LLAMA);
    await expect(call('engine.llama', {})).resolves.toEqual(LLAMA);
    expect(asked).toEqual([{ checkLatest: true }, { checkLatest: false }]);
  });

  it('give the models recommended, and download one — a file that is not the one published said in its own words', async () => {
    const model = { id: 'qwen3-8b', family: 'qwen' as const, name: 'Qwen3 8B', file: 'Qwen3-8B-Q4_K_M.gguf', bytes: 5, context: 32768, path: null, downloading: null };
    const { call } = setup(async () => READY, {
      recommendedModels: async () => [model],
      downloadModel: async () => ({ ...model, path: 'C:\data\models\Qwen3-8B-Q4_K_M.gguf' }),
    });
    await expect(call('engine.recommended', undefined)).resolves.toEqual([model]);
    await expect(call('engine.model.download', { id: 'qwen3-8b' })).resolves.toMatchObject({ ok: true, model: { id: 'qwen3-8b' } });
    const mismatch = setup(async () => READY, {
      downloadModel: async () => Promise.reject(new DigestMismatchError('https://huggingface.co/x.gguf')),
    }).call;
    await expect(mismatch('engine.model.download', { id: 'qwen3-8b' })).resolves.toMatchObject({ ok: false, error: { code: 'digest' } });
  });

  it('install llama.cpp, and say a file that is not the one published in its own words', async () => {
    const { call } = setup(async () => READY);
    await expect(call('engine.llama.install', undefined)).resolves.toMatchObject({
      ok: true,
      state: { current: { source: 'managed', build: 'b12383' } },
    });
    const mismatch = setup(async () => READY, {
      installLlamaCpp: async () => Promise.reject(new DigestMismatchError('https://github.com/x.zip')),
    }).call;
    await expect(mismatch('engine.llama.install', undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'digest' },
    });
    const offline = setup(async () => READY, { installLlamaCpp: async () => Promise.reject(new Error('fetch failed')) }).call;
    await expect(offline('engine.llama.install', undefined)).resolves.toEqual({
      ok: false,
      error: { code: 'failed', detail: 'fetch failed' },
    });
  });
});

describe('changing model through the bridge (task 7.4)', () => {
  const view = {
    to: { path: 'C:/models/qwen.gguf', name: 'qwen' },
    from: { path: 'C:/models/gemma.gguf', name: 'gemma' },
    announcement: { kind: 'model-switch' as const, reloadSeconds: 5, rereadTokens: 18_400, rereadSeconds: 20, vramBytes: 4, vramBytesNow: 23, estimated: false },
  };

  it('says the cost first, for the conversation named', async () => {
    const asked: unknown[] = [];
    const { call } = setup(async () => READY, {
      modelSwitch: async (path, conversationId) => {
        asked.push([path, conversationId]);
        return view;
      },
    });
    await expect(call('engine.switchCost', { path: 'C:/models/qwen.gguf', conversationId: 'c1' })).resolves.toEqual(view);
    expect(asked).toEqual([['C:/models/qwen.gguf', 'c1']]);
  });

  it('changes model, or says why not: a reply that runs, a family it cannot speak', async () => {
    let answer: () => Promise<{ state: EngineState; conversationId?: string }> = async () => ({ state: READY, conversationId: 'c2' });
    const { call } = setup(async () => READY, { switchModel: () => answer() });
    await expect(call('engine.switch', { path: 'C:/models/qwen.gguf', conversationId: 'c1', as: 'copy' })).resolves.toEqual({ ok: true, state: READY, conversationId: 'c2' });
    answer = async () => {
      throw new EngineBusyError();
    };
    await expect(call('engine.switch', { path: 'C:/models/qwen.gguf' })).resolves.toMatchObject({ ok: false, error: { code: 'busy' } });
    answer = async () => {
      throw new UnsupportedFamilyError('unsupported-family');
    };
    await expect(call('engine.switch', { path: 'C:/models/qwen.gguf' })).resolves.toMatchObject({ ok: false, error: { code: 'unsupported-family' } });
  });
});

describe('the settings that restart the engine, through the bridge (task 7.4)', () => {
  it('reads them, says what a change costs, and keeps one — with a restart or for the next load', async () => {
    const applied: unknown[] = [];
    const { call } = setup(async () => READY, {
      engineSettings: async () => ({ nCtx: 8192, cacheType: 'f16', gpuLayers: 'all', subagents: 'sequential' }),
      restartCost: async (changes) => ({ kind: 'restart', setting: Object.keys(changes)[0]!, reloadSeconds: 5, estimated: false, memoriesLost: 2, replyRunning: false, loaded: true }),
      applyEngineSettings: async (changes, options) => void applied.push([changes, options]),
    });
    await expect(call('engine.settings', undefined)).resolves.toEqual({ nCtx: 8192, cacheType: 'f16', gpuLayers: 'all', subagents: 'sequential' });
    await expect(call('engine.restartCost', { cacheType: 'q8_0' })).resolves.toMatchObject({ setting: 'cacheType', memoriesLost: 2 });
    await call('engine.applySettings', { changes: { nCtx: 16_384 }, restart: true });
    expect(applied).toEqual([[{ nCtx: 16_384 }, { restart: true }]]);
  });

  it('refuses a change that changes nothing, or a context out of bounds, before it reaches the core', async () => {
    const { call } = setup(async () => READY, { applyEngineSettings: async () => undefined });
    await expect(call('engine.applySettings', { changes: {}, restart: true })).rejects.toThrow();
    await expect(call('engine.applySettings', { changes: { nCtx: 100 }, restart: true })).rejects.toThrow();
  });
});
