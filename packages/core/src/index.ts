/**
 * @aparte/bonaparte-core — the core of bonaparte: pure Node, never Electron.
 */

export { spawnHidden } from './process/spawn.js';
export type { SpawnFn, SpawnHiddenOptions, SpawnedProcess } from './process/spawn.js';
export { KeyedQueue, readJsonFile, writeJsonFile } from './fs/json-file.js';
export { bonaparteDataDir } from './paths.js';
export { LlamaCppHttpClient, LlamaCppHttpError } from './backend/llamacpp/http-client.js';
export type * from './backend/types.js';
export { createCore, ModelNotListedError } from './api.js';
export type { Core, CoreDeps, Engine, EngineState, ModelChoice } from './api.js';
export type { EngineLoadAnnouncement, Announcement } from './costs/announce.js';
export type { FamilyId } from './families/index.js';
export { UnsupportedFamilyError } from './families/index.js';
export { EngineStoppedError } from './backend/llamacpp/managed-server.js';
export { AGENT_ENDPOINT, createAgentHandler } from './agent/handler.js';
export { agentBodySchema } from './agent/body.js';
export type { AgentBody } from './agent/body.js';
export { encodeEvent } from './agent/run-events.js';
export type { RunEvent, WireLine } from './agent/run-events.js';
