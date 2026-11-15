/**
 * The engine's channels: glue between the bridge and the core. A load that
 * fails is answered with a code, never thrown: the window says it in its own
 * words, and keeps the engine's own lines for whoever opens them.
 */

import {
  DigestMismatchError,
  EngineBusyError,
  EngineStoppedError,
  ModelNotListedError,
  UnsupportedFamilyError,
  type Core,
} from '@aparte/bonaparte-core';
import {
  engineLlama,
  engineLlamaInstall,
  engineLoad,
  engineModels,
  engineState,
  engineSwitch,
  engineSwitchCost,
  type EngineLoadResult,
  type LlamaInstallResult,
} from '@aparte/bonaparte-shared';
import type { IpcRegistry } from './register.js';

function loadError(error: unknown): EngineLoadResult {
  // An engine that stopped: its own lines, as it wrote them, not our sentence around them.
  const said = error instanceof EngineStoppedError && error.said ? error.said : undefined;
  const detail = (said ?? (error instanceof Error ? error.message : String(error))).slice(-4000);
  if (error instanceof ModelNotListedError) return { ok: false, error: { code: 'not-listed', detail } };
  if (error instanceof UnsupportedFamilyError) return { ok: false, error: { code: error.code, detail } };
  return { ok: false, error: { code: 'failed', detail } };
}

export function registerEngineChannels(
  ipc: IpcRegistry,
  core: Pick<Core, 'engineState' | 'models' | 'loadModel' | 'llamaCpp' | 'installLlamaCpp' | 'modelSwitch' | 'switchModel'>,
): void {
  ipc.handle(engineState, () => core.engineState());
  ipc.handle(engineModels, () => core.models());
  ipc.handle(engineLoad, async ({ path }) => {
    try {
      return { ok: true, state: await core.loadModel(path) };
    } catch (error) {
      return loadError(error);
    }
  });
  ipc.handle(engineSwitchCost, ({ path, conversationId }) => core.modelSwitch(path, conversationId));
  ipc.handle(engineSwitch, async ({ path, conversationId, as }) => {
    try {
      const done = await core.switchModel(path, { ...(conversationId ? { conversationId } : {}), ...(as ? { as } : {}) });
      return { ok: true, state: done.state, ...(done.conversationId ? { conversationId: done.conversationId } : {}) };
    } catch (error) {
      if (error instanceof EngineBusyError) return { ok: false, error: { code: 'busy', detail: error.message } };
      return loadError(error);
    }
  });
  ipc.handle(engineLlama, ({ checkLatest }) => core.llamaCpp({ checkLatest: checkLatest === true }));
  ipc.handle(engineLlamaInstall, async (): Promise<LlamaInstallResult> => {
    try {
      return { ok: true, state: await core.installLlamaCpp() };
    } catch (error) {
      const detail = (error instanceof Error ? error.message : String(error)).slice(-4000);
      return { ok: false, error: { code: error instanceof DigestMismatchError ? 'digest' : 'failed', detail } };
    }
  });
}
