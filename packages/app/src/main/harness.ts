/**
 * Bridge between @aparte/bonaparte-core and Electron: the active chat
 * session, the app config, the window and its dialogs. The engine's life
 * cycle belongs to core's `EngineSupervisor`; the model is not a parameter of
 * the engine — each conversation pins its own, and the managed server is
 * (re)started with the model of the active conversation. All business logic
 * lives in core — here, only wiring.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  bonaparteDataDir,
  builtinTools,
  ChatSession,
  ConversationStore,
  createSystemDoctorEnv,
  defaultScanRoots,
  EngineSupervisor,
  HARNESS_SETTINGS,
  KV_INVALIDATING_KEYS,
  KvStore,
  kvSlotsDir,
  PermissionEngine,
  PluginHost,
  ProjectStore,
  probeEndpoint,
  resolveSettings,
  SAMPLING_SETTINGS,
  scanModels,
  ToolRegistry,
  type EngineConfig,
  type KvCacheType,
  type PlayMode,
  type PluginNodeModule,
  type SamplingParams,
  type SettingField,
  type SettingLayers,
  harnessT,
} from '@aparte/bonaparte-core';
import {
  IPC,
  type AgentEventDto,
  type AppConfigDto,
  type ApprovalResponseDto,
  type BackendConfigDto,
  type BackendStatusDto,
  type ConversationEventDto,
  type ConversationSummaryDto,
  type ConversationOpenReplyDto,
  type EndpointProbeDto,
  type ModelInfoDto,
  type PickFileKind,
  type PlayModeDto,
  type PluginStatusDto,
  type ProjectDto,
  type ProjectSummaryDto,
  type ResolvedSettingDto,
  type SettingScopeDto,
  type SetupSuggestionDto,
  type BonaparteLocale,
} from '@aparte/bonaparte-shared';
import { app, dialog, shell } from 'electron';
import type { BrowserWindow, IpcMain } from 'electron';
import { existsSync } from 'node:fs';
import { resolvePluginsDir } from './plugins-dir.js';

/** Global settings that are launch parameters of the engine (D-17). */
const LAUNCH_KEYS = new Set(['nCtx', 'cacheType', 'nGpuLayers']);

/** Only external destinations allowed from the renderer. */
const EXTERNAL_URL_ALLOWLIST = [/^https:\/\/github\.com\/ggml-org\/llama\.cpp(\/|$)/];

function stripThink(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
}

function modelDisplayName(modelPath: string): string {
  return basename(modelPath).replace(/\.gguf$/i, '');
}

/**
 * Conversation identifier. It no longer derives from the project: a
 * conversation exists on its own, with or without a folder, and it must be
 * possible to hold several of them on the same project. The leading
 * timestamp keeps folders readable and sorted on disk.
 */
function newConversationId(): string {
  return `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

export class Harness {
  private window: BrowserWindow | null = null;
  /**
   * The engine — managed server or remote endpoint — lives in core. A model
   * switch saves the open conversation's state while its server is still
   * alive, and the session goes with the server it was bound to.
   */
  private readonly supervisor = new EngineSupervisor({
    slotsDir: kvSlotsDir(),
    pidFile: join(bonaparteDataDir(), 'managed-server.pid'),
    beforeUnload: async () => {
      await this.saveKv();
      this.session = null;
    },
  });
  private readonly unsubscribeEngineStatus = this.supervisor.onStatusChange((status) =>
    this.emit(IPC.evBackendStatus, status),
  );
  /**
   * Scope of the OPEN conversation — not of the application.
   *
   * The roots come from the PROJECT the conversation is attached to: one
   * single place to edit, one single place for permissions. Empty is a
   * normal case (conversation without a project): the tools work, without
   * confinement.
   */
  private roots: string[] = [];
  private currentConversationId: string | null = null;
  private readonly registry = new ToolRegistry();
  private readonly pluginHost = new PluginHost({
    registry: this.registry,
    logger: (message) => console.log(message),
    // `core` doesn't know about Electron: this is where a plugin event
    // becomes an IPC message to the window.
    emit: (pluginId, instanceId, event, payload) => {
      this.emit(IPC.evPlugin, { pluginId, instanceId, event, payload });
    },
  });
  private readonly permissions = new PermissionEngine('repetition');
  private readonly pendingApprovals = new Map<
    string,
    {
      resolve: (granted: boolean) => void;
      request: { tool: string; command?: string };
    }
  >();
  private session: ChatSession | null = null;

  private readonly kv = new KvStore(kvSlotsDir());
  private readonly store = new ConversationStore(
    join(bonaparteDataDir(), 'conversations'),
  );
  private readonly projects = new ProjectStore(bonaparteDataDir());
  private readonly configPath = join(bonaparteDataDir(), 'config', 'global.json');

  /**
   * Disk tools follow the project: without a project, they are NOT in the
   * inventory (hence unemittable), and opening one announces them via an
   * inventory delta in ongoing conversations.
   */
  /**
   * Built-in tools are ALWAYS available. The project is their scope — with
   * one, paths are confined to it; without one, they start from the home
   * folder — but it was never their condition of existence.
   *
   * (The previous version conditioned registration on "the registry is
   * empty", which the plugin tools made false: the file tools would silently
   * stop registering ever again.)
   */
  private registerBuiltinTools(): void {
    const present = new Set(this.registry.list().map((tool) => tool.name));
    for (const tool of builtinTools()) {
      if (!present.has(tool.def.name)) {
        this.registry.register(tool.def, tool.handler, 'builtin');
      }
    }
  }

  attachWindow(window: BrowserWindow): void {
    this.window = window;
  }

  /** Restores project and mode from config at startup. */
  async restoreSession(): Promise<void> {
    // First of all: a server left behind by a session that died abruptly.
    await this.supervisor.killOrphan();
    await this.purgeLegacyConversations();
    await this.loadPlugins();
    const config = await this.loadConfig();
    // We reopen the last conversation, and it is THAT conversation that says
    // whether there is a project. Nothing is loaded into VRAM here: only meta.
    if (config.currentConversationId && (await this.store.exists(config.currentConversationId))) {
      this.currentConversationId = config.currentConversationId;
      this.roots = await this.rootsOf(config.currentConversationId);
    }
    this.registerBuiltinTools();
    if (config.mode) this.permissions.setMode(config.mode as PlayMode);
  }

  /**
   * Clean slate for old-shape conversations (Paul's decision, 2026-08-20).
   *
   * Before the redesign, a conversation carried its own folder
   * (`projectRoot`). The scope now belongs to the PROJECT. Writing
   * compatibility code for a handful of conversations didn't make sense: we
   * delete them along with their KV state, and we SAY so in the log rather
   * than making them disappear silently.
   *
   * Detection is based on the raw JSON: the field no longer exists in the type.
   */
  private async purgeLegacyConversations(): Promise<void> {
    const dir = join(bonaparteDataDir(), 'conversations');
    let ids: string[];
    try {
      ids = await readdir(dir);
    } catch {
      return;
    }
    for (const id of ids) {
      let raw: string;
      try {
        raw = await readFile(join(dir, id, 'meta.json'), 'utf8');
      } catch {
        continue;
      }
      if (!raw.includes('"projectRoot"')) continue;
      await this.store.remove(id);
      await this.kv.forget(id);
      console.log(`[conversations] old-shape conversation purged: ${id}`);
    }
  }

  /**
   * Roots in effect for a conversation: those of ITS project.
   *
   * A conversation without a project, or whose project has been deleted,
   * yields an empty scope — which is a legitimate state, not an error: the
   * tools work, simply without confinement.
   */
  private async rootsOf(conversationId: string): Promise<string[]> {
    const { projectId } = await this.store.meta(conversationId);
    if (!projectId) return [];
    return (await this.projects.get(projectId))?.roots ?? [];
  }

  /** Project name for display, or nothing if there is none. */
  private async projectNameOf(
    projectId: string | undefined,
  ): Promise<{ projectName?: string }> {
    if (!projectId) return {};
    const project = await this.projects.get(projectId);
    return project ? { projectName: project.name } : {};
  }

  /** Current conversation, created on the fly if the app doesn't have one yet. */
  private async ensureConversationId(): Promise<string> {
    if (this.currentConversationId) return this.currentConversationId;
    const metas = await this.store.listMeta();
    const id = metas[0]?.id ?? (await this.createConversation());
    await this.setCurrentConversation(id);
    return id;
  }

  private async setCurrentConversation(id: string): Promise<void> {
    this.currentConversationId = id;
    this.roots = await this.rootsOf(id);
    this.registerBuiltinTools();
    const config = await this.loadConfig();
    await this.saveConfig({ ...config, currentConversationId: id });
  }

  async listConversations(): Promise<ConversationSummaryDto[]> {
    const metas = await this.store.listMeta();
    return Promise.all(
      metas.map(async (meta) => ({
        id: meta.id,
        title: meta.title,
        updatedAt: meta.updatedAt,
        ...(meta.projectId ? { projectId: meta.projectId } : {}),
        ...(await this.projectNameOf(meta.projectId)),
        ...(meta.modelPath ? { modelName: modelDisplayName(meta.modelPath) } : {}),
        // An instant resume is only promised on the evidence: the state must exist.
        hasKvState: await this.kv.has(meta.id),
      })),
    );
  }

  async createConversation(projectRoot?: string): Promise<string> {
    const id = newConversationId();
    const defaults = (await this.loadConfig()).defaultModel;
    await this.store.create(id, {
      ...(projectRoot ? { projectRoot } : {}),
      ...(defaults?.path ? { modelPath: defaults.path } : {}),
    });
    return id;
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.store.setTitle(id, title);
  }

  // ── Plugins ────────────────────────────────────────────────────────────

  /** Plugins folder — see `resolvePluginsDir` for the three layouts. */
  private pluginsDir(): string {
    return resolvePluginsDir({
      env: process.env,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
      exists: existsSync,
    });
  }

  /**
   * Reload counter, used as an ESM import cache-buster.
   *
   * `import()` memoizes by URL: without this parameter, reactivating a plugin
   * would replay the OLD module even after recompilation. This is the only
   * way to make an already-loaded ESM module forgotten.
   */
  private pluginGeneration = 0;

  /**
   * Reloads plugins HOT: full teardown then re-discovery.
   *
   * This is exactly what the host was made reversible for — everything a
   * plugin registered leaves with its context. Without this, touching a
   * plugin's Node half required restarting the app, hence reloading the
   * model into VRAM: several dozen seconds for three lines of plugin code.
   */
  async reloadPlugins(): Promise<PluginStatusDto[]> {
    await this.pluginHost.deactivateAll();
    this.pluginGeneration += 1;
    await this.loadPlugins();
    // The tool inventory may have changed: ongoing conversations will learn
    // about it via a delta on their next opening.
    this.registerBuiltinTools();
    this.session = null;
    return this.listPlugins();
  }

  /**
   * Discovers then activates plugins. A plugin that fails is KEPT along with
   * its error — the Settings hub must be able to show it rather than making
   * it disappear without explanation.
   */
  async loadPlugins(): Promise<void> {
    const found = await this.pluginHost.discover(this.pluginsDir());
    for (const plugin of found) {
      if (!plugin.manifest || plugin.error) continue;
      try {
        const nodeEntry = plugin.manifest.entry.node;
        const module: PluginNodeModule = nodeEntry
          ? ((
              (await import(
                `${pathToFileURL(join(plugin.dir, nodeEntry)).href}?v=${this.pluginGeneration}`,
              )) as {
                default: PluginNodeModule;
              }
            ).default)
          : { activate: () => undefined };
        await this.pluginHost.activate(plugin.id, module);
      } catch (error) {
        console.error(
          `[plugins] ${plugin.id} could not be activated:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  listPlugins(): PluginStatusDto[] {
    return this.pluginHost.status();
  }

  // ── Settings ───────────────────────────────────────────────────────────

  /** Harness fields plus those contributed by active plugins. */
  private settingFields(): SettingField[] {
    const fromPlugins = this.pluginHost
      .status()
      .filter((plugin) => plugin.active)
      .flatMap(() => [] as SettingField[]);
    return [...HARNESS_SETTINGS, ...fromPlugins];
  }

  private async settingLayers(): Promise<SettingLayers> {
    const config = await this.loadConfig();
    const conversation = this.currentConversationId
      ? (await this.store.meta(this.currentConversationId).catch(() => null))?.settings
      : undefined;
    return {
      ...(config.settings ? { global: config.settings } : {}),
      ...(conversation ? { conversation } : {}),
    };
  }

  async getSettings(scope: SettingScopeDto): Promise<ResolvedSettingDto[]> {
    const resolved = resolveSettings(this.settingFields(), await this.settingLayers(), scope);
    return resolved.map((setting) => ({
      key: setting.key,
      label: setting.field.label,
      type: setting.field.type,
      ...(setting.field.description ? { description: setting.field.description } : {}),
      ...(setting.field.options ? { options: setting.field.options } : {}),
      ...(setting.field.min !== undefined ? { min: setting.field.min } : {}),
      ...(setting.field.max !== undefined ? { max: setting.field.max } : {}),
      ...(setting.field.step !== undefined ? { step: setting.field.step } : {}),
      ...(setting.field.advanced ? { advanced: true } : {}),
      value: setting.value,
      from: setting.from,
      overridden: setting.overridden,
      // The UI must warn BEFORE the change, not observe it after the fact.
      invalidatesKv: KV_INVALIDATING_KEYS.has(setting.key),
    }));
  }

  async setSetting(scope: SettingScopeDto, key: string, value: unknown): Promise<void> {
    if (scope === 'conversation') {
      const id = this.currentConversationId;
      if (!id) return;
      await this.store.setSetting(id, key, value);
      // The session carries the sampling params: it will be reopened on the
      // next message with the new values.
      this.session = null;
      return;
    }
    const config = await this.loadConfig();
    const settings = { ...(config.settings ?? {}) };
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    await this.saveConfig({ ...config, settings });
    if (LAUNCH_KEYS.has(key) && config.backend) {
      // The server no longer matches its parameters: it goes down now (its
      // state saved first) and the next message brings it up with the new
      // ones. Saved states whose context size differs are refused by the
      // manifest and announced as a re-prefill.
      await this.saveKv();
      await this.supervisor.configure(await this.engineConfig(config.backend));
    }
    this.session = null;
  }

  /**
   * Launch parameters come from the GLOBAL settings (D-17): the context
   * size, the cache quantization and the GPU layers belong to the engine,
   * never to a conversation — two conversations on one model share one
   * server.
   */
  private async launchSettings(): Promise<{
    nCtx: number;
    cacheType: KvCacheType;
    nGpuLayers?: number;
  }> {
    const resolved = resolveSettings(HARNESS_SETTINGS, await this.settingLayers(), 'global');
    const value = (key: string): unknown => resolved.find((setting) => setting.key === key)?.value;
    const nCtx = value('nCtx');
    const cacheType = value('cacheType');
    const nGpuLayers = value('nGpuLayers');
    return {
      nCtx: typeof nCtx === 'number' && nCtx > 0 ? nCtx : 8192,
      cacheType: cacheType === 'q8_0' || cacheType === 'q4_0' ? cacheType : 'f16',
      ...(typeof nGpuLayers === 'number' ? { nGpuLayers } : {}),
    };
  }

  private async engineConfig(config: BackendConfigDto): Promise<EngineConfig> {
    if (config.mode === 'remote') return { mode: 'remote', url: config.url };
    const launch = await this.launchSettings();
    const nGpuLayers = config.nGpuLayers ?? launch.nGpuLayers;
    return {
      mode: 'managed',
      binPath: config.binPath,
      nCtx: launch.nCtx,
      cacheType: launch.cacheType,
      ...(nGpuLayers !== undefined ? { nGpuLayers } : {}),
    };
  }

  /** Whether the open conversation lets the model reason (default: yes). */
  private async currentThinking(): Promise<boolean> {
    const resolved = resolveSettings(SAMPLING_SETTINGS, await this.settingLayers(), 'conversation');
    const value = resolved.find((setting) => setting.key === 'thinking')?.value;
    return typeof value === 'boolean' ? value : true;
  }

  /** Effective sampling for the open conversation. */
  private async currentSampling(): Promise<SamplingParams> {
    const resolved = resolveSettings(
      SAMPLING_SETTINGS,
      await this.settingLayers(),
      'conversation',
    );
    const value = (key: string): number | undefined => {
      const found = resolved.find((setting) => setting.key === key)?.value;
      return typeof found === 'number' ? found : undefined;
    };
    const seed = value('seed');
    return {
      ...(value('temperature') !== undefined ? { temperature: value('temperature') } : {}),
      ...(value('topP') !== undefined ? { topP: value('topP') } : {}),
      ...(value('topK') !== undefined ? { topK: value('topK') } : {}),
      ...(value('minP') !== undefined ? { minP: value('minP') } : {}),
      // -1 = "random": don't send it rather than sending a fixed seed.
      ...(seed !== undefined && seed >= 0 ? { seed } : {}),
    };
  }

  /**
   * Title drawn from the first message, and from it alone: renaming later
   * would overwrite a title the user may have chosen themselves.
   */
  private async titleFromFirstMessage(text: string): Promise<void> {
    const id = this.currentConversationId;
    if (!id) return;
    try {
      const events = await this.store.loadEvents(id);
      if (events.some((event) => event.type === 'user')) return;
      const line = text.trim().replace(/\s+/g, ' ');
      if (!line) return;
      await this.store.setTitle(id, line.length > 60 ? `${line.slice(0, 57)}…` : line);
    } catch {
      /* a title is a convenience: never something that should fail a send */
    }
  }

  /**
   * "Project" view exposed to the renderer.
   *
   * Interim: the DTO still carries only one root, the default one. The
   * screens that will show the full project — name, N roots, editing — are
   * step 2, and that's when this DTO will become a real project.
   */
  private project(recents: string[] = []): ProjectDto | null {
    const primary = this.roots[0];
    if (!primary) return null;
    return {
      root: primary,
      name: basename(primary),
      recents,
    };
  }

  async currentProject(): Promise<ProjectDto | null> {
    const config = await this.loadConfig();
    return this.project(config.recentProjects ?? []);
  }

  // ── Projects ───────────────────────────────────────────────────────────

  async listProjects(): Promise<ProjectSummaryDto[]> {
    const projects = await this.projects.list();
    return projects.map(({ id, name, roots }) => ({ id, name, roots }));
  }

  async createProject(name: string, roots: string[] = []): Promise<ProjectSummaryDto> {
    const { id, roots: saved } = await this.projects.create({ name, roots });
    return { id, name, roots: saved };
  }

  async renameProject(id: string, name: string): Promise<ProjectSummaryDto> {
    const project = await this.projects.rename(id, name);
    await this.refreshRoots();
    return { id: project.id, name: project.name, roots: project.roots };
  }

  async setProjectRoots(id: string, roots: string[]): Promise<ProjectSummaryDto> {
    const project = await this.projects.setRoots(id, roots);
    // The scope has changed: the ongoing session carries the old one, it must
    // be rebuilt so the delta gets announced to the model on reopening.
    await this.refreshRoots();
    return { id: project.id, name: project.name, roots: project.roots };
  }

  async removeProject(id: string): Promise<void> {
    // The project's conversations are NOT deleted: they become "without a
    // project", hence without confinement. Losing a folder must never mean
    // losing a history.
    for (const meta of await this.store.listMeta()) {
      if (meta.projectId === id) await this.store.setProjectId(meta.id, undefined);
    }
    await this.projects.remove(id);
    await this.refreshRoots();
  }

  async setConversationProject(
    conversationId: string,
    projectId: string | null,
  ): Promise<void> {
    await this.store.setProjectId(conversationId, projectId ?? undefined);
    await this.refreshRoots();
  }

  /** Pure folder picker: no side effect, just the path. */
  async pickDirectory(): Promise<string | null> {
    if (!this.window) return null;
    const result = await dialog.showOpenDialog(this.window, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  /**
   * Recomputes the scope of the open conversation and invalidates the session.
   *
   * The session carries the scope it was built with: leaving it in place
   * would make the model work against a stale backdrop. Rebuilding it
   * triggers the delta on the next send.
   */
  private async refreshRoots(): Promise<void> {
    if (!this.currentConversationId) return;
    this.roots = await this.rootsOf(this.currentConversationId);
    this.session = null;
    this.registerBuiltinTools();
  }

  async openProject(): Promise<ProjectDto | null> {
    if (!this.window) return null;
    const result = await dialog.showOpenDialog(this.window, {
      properties: ['openDirectory'],
    });
    const picked = result.canceled ? null : (result.filePaths[0] ?? null);
    if (!picked) return null;

    // The folder belongs to the PROJECT, and the conversation belongs to a
    // project. Picking a folder from a conversation without a project
    // therefore creates one, named after the folder; from a conversation that
    // already has one, the folder is added to its roots.
    const id = await this.ensureConversationId();
    const { projectId } = await this.store.meta(id);

    if (projectId && (await this.projects.get(projectId))) {
      const project = await this.projects.get(projectId);
      const roots = project?.roots ?? [];
      if (!roots.includes(picked)) {
        await this.projects.setRoots(projectId, [...roots, picked]);
      }
    } else {
      const created = await this.projects.create({
        name: basename(picked),
        roots: [picked],
      });
      await this.store.setProjectId(id, created.id);
    }

    this.roots = await this.rootsOf(id);
    this.session = null;
    this.registerBuiltinTools();

    const config = await this.loadConfig();
    const recents = [picked, ...(config.recentProjects ?? []).filter((p) => p !== picked)]
      .slice(0, 8);
    await this.saveConfig({ ...config, recentProjects: recents });
    return this.project(recents);
  }

  getMode(): PlayModeDto {
    return this.permissions.getMode();
  }

  async setMode(mode: PlayModeDto): Promise<void> {
    this.permissions.setMode(mode as PlayMode);
    const config = await this.loadConfig();
    await this.saveConfig({ ...config, mode });
  }

  /** Asks for the user's consent; resolved by respondToApproval. */
  private readonly approve = (request: {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    command?: string;
  }): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (!this.window || this.window.isDestroyed()) {
        resolve(false); // no one to ask: fail-safe
        return;
      }
      this.pendingApprovals.set(request.id, {
        resolve,
        request: {
          tool: request.tool,
          ...(request.command !== undefined ? { command: request.command } : {}),
        },
      });
      this.emit(IPC.evApproval, request);
    });

  async respondToApproval(response: ApprovalResponseDto): Promise<void> {
    const pending = this.pendingApprovals.get(response.id);
    if (!pending) return;
    this.pendingApprovals.delete(response.id);

    if (response.granted && response.always) {
      // "Always allow": for a command, the rule applies to its first word
      // (e.g. "pnpm"), not the whole line.
      const prefix = pending.request.command?.trim().split(/\s+/)[0];
      this.permissions.remember({
        tool: pending.request.tool,
        ...(prefix ? { commandPrefix: prefix } : {}),
      });
    }
    pending.resolve(response.granted);
  }

  private emit(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, payload);
    }
  }

  async loadConfig(): Promise<AppConfigDto> {
    try {
      const raw = JSON.parse(await readFile(this.configPath, 'utf8')) as {
        backend?: BackendConfigDto & { modelPath?: string; nCtx?: number };
      };
      // Migration: old configs carried modelPath/nCtx on the engine — they
      // now belong to each conversation.
      if (raw.backend) {
        delete raw.backend.modelPath;
        delete raw.backend.nCtx;
      }
      return raw as AppConfigDto;
    } catch {
      return {};
    }
  }

  async saveConfig(config: AppConfigDto): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  status(): BackendStatusDto {
    return this.supervisor.status();
  }

  /**
   * Registers the engine WITHOUT connecting to it: on startup, bonaparte must
   * neither ping an endpoint (some servers load the model on the slightest
   * request) nor launch a llama-server. `startEngine` activates it.
   */
  async registerEngine(config: BackendConfigDto): Promise<void> {
    await this.supervisor.configure(await this.engineConfig(config));
    this.session = null;
  }

  /** Remote: immediate connection. Managed: the server starts with the first conversation that names a model. */
  async startEngine(config: BackendConfigDto): Promise<BackendStatusDto> {
    await this.registerEngine(config);
    if (config.mode === 'remote') await this.supervisor.connect();
    return this.status();
  }

  async openConversation(id?: string, modelPath?: string): Promise<ConversationOpenReplyDto> {
    const engine = this.supervisor.engine;
    if (!engine) throw new Error('Engine not configured.');
    id ??= await this.ensureConversationId();

    // Switch: the state of the conversation we're leaving must be saved
    // BEFORE opening another one, otherwise its cache is lost and resuming
    // will cost a full re-prefill — exactly what we claim to avoid.
    if (this.session && this.currentConversationId && this.currentConversationId !== id) {
      await this.session.save().catch(() => false);
      this.session = null;
    }
    if (await this.store.exists(id)) await this.setCurrentConversation(id);

    // Resolves the model: pinned meta > parameter > Settings default. The
    // context size is the engine's, not the conversation's (D-17).
    const defaults = (await this.loadConfig()).defaultModel;
    let convModel: string | undefined;
    const meta = (await this.store.exists(id)) ? await this.store.meta(id) : undefined;
    convModel = meta?.modelPath ?? modelPath ?? defaults?.path;

    if (engine.mode === 'managed') {
      if (!convModel) return { needsModel: true, conversationId: id };
      // A model whose file has vanished is announced BEFORE any launch: the
      // engine would only fail later, with an error about a file the user
      // deleted weeks ago. Nothing is pinned here either — the pick that
      // follows is the one that gets recorded.
      if (!existsSync(convModel)) {
        return { needsModel: true, conversationId: id, missingModel: convModel };
      }
      if (meta && !meta.modelPath) await this.store.setModel(id, convModel);
      await this.supervisor.ensureLoaded(convModel);
    } else {
      if (meta && !meta.modelPath && convModel) {
        await this.store.setModel(id, convModel);
      }
      // Remote: the model is whatever the server has — informational only.
      if (!convModel) convModel = this.supervisor.loaded?.modelPath ?? 'remote';
    }

    const backend = this.supervisor.backend;
    const live = this.supervisor.live;
    if (!backend || !live) throw new Error('Backend not started.');

    if (!(await this.store.exists(id))) {
      await this.store.create(id, { modelPath: convModel });
    }

    const { session, restore } = await ChatSession.open(
      {
        backend,
        kv: this.kv,
        store: this.store,
        registry: this.registry,
        permissions: this.permissions,
        ...(this.roots.length > 0 ? { roots: this.roots } : {}),
        approve: this.approve,
        // The thread is in English; only the reply language follows the user.
        replyLanguage: (await this.loadConfig()).locale === 'en' ? 'English' : 'French',
        sampling: await this.currentSampling(),
        thinking: await this.currentThinking(),
        live,
      },
      id,
    );
    this.session = session;

    const events = await this.store.loadEvents(id);
    return {
      conversationId: id,
      modelPath: convModel,
      modelName: modelDisplayName(convModel),
      // Denominator of the context gauge: what the server holds.
      ...(live.nCtx > 0 ? { nCtx: live.nCtx } : {}),
      // Tool calls and their results stay out of the UI: they live in the
      // transcript, not in the conversation being read.
      events: events
        .flatMap((event): ConversationEventDto[] => {
          if (event.type === 'user') {
            return [{ type: 'user', text: event.text, at: event.at }];
          }
          // A corrupted log line is skipped, it doesn't take the opening of
          // the conversation down with it.
          if (event.type === 'assistant' && event.entry) {
            return [
              {
                type: 'assistant',
                text: stripThink(event.entry.text),
                at: event.at,
              },
            ];
          }
          return [];
        })
        .filter((event) => event.text.trim() !== ''),
      restore: restore.restored
        ? { restored: true, nRestored: restore.nRestored }
        : { restored: false, reason: restore.reason },
    };
  }

  /**
   * History of a conversation WITHOUT touching the engine: launching the app
   * must neither wake a server nor load a model into VRAM. The connection
   * only happens on the first message.
   */
  async conversationHistory(select?: string): Promise<ConversationOpenReplyDto> {
    // Switching conversation is a READ operation: the history comes from the
    // log on disk, never from the KV cache — the latter only speeds up the
    // next generation. Browsing one's conversations must therefore load no
    // model and wake no engine.
    if (select && select !== this.currentConversationId) {
      // The state of the one we're leaving is saved if a session was
      // running: otherwise its cache would be lost and coming back to it
      // would cost a re-prefill.
      if (this.session) {
        await this.session.save().catch(() => false);
        this.session = null;
      }
      if (await this.store.exists(select)) await this.setCurrentConversation(select);
    }

    const id = this.currentConversationId;
    if (!id || !(await this.store.exists(id))) {
      return {
        conversationId: id ?? '',
        events: [],
        restore: { restored: false, reason: 'missing' },
      };
    }
    const meta = await this.store.meta(id);
    const events = await this.store.loadEvents(id);
    return {
      conversationId: id,
      ...(meta.modelPath
        ? {
            modelPath: meta.modelPath,
            modelName: modelDisplayName(meta.modelPath),
            // Announced at open: a vanished file is a fact about this
            // machine, not about the message the user has yet to type.
            ...(this.supervisor.engine?.mode === 'managed' && !existsSync(meta.modelPath)
              ? { missingModel: meta.modelPath }
              : {}),
          }
        : {}),
      events: events
        .flatMap((event): ConversationEventDto[] => {
          if (event.type === 'user') {
            return [{ type: 'user', text: event.text, at: event.at }];
          }
          // A corrupted log line is skipped, it doesn't take the opening of
          // the conversation down with it.
          if (event.type === 'assistant' && event.entry) {
            return [
              { type: 'assistant', text: stripThink(event.entry.text), at: event.at },
            ];
          }
          return [];
        })
        .filter((event) => event.text.trim() !== ''),
      restore: { restored: false, reason: 'not-connected' },
    };
  }

  async send(text: string): Promise<void> {
    // Lazy connection: it's the first message that wakes the engine.
    if (!this.session && this.supervisor.engine) {
      const reply = await this.openConversation();
      if ('needsModel' in reply) {
        // Not an error: a choice to make. The renderer opens the picker and
        // keeps the message for after the pick.
        this.emit(IPC.evAgent, {
          type: 'needs_model',
          conversationId: reply.conversationId,
          ...(reply.missingModel ? { missingModel: reply.missingModel } : {}),
        } satisfies AgentEventDto);
        return;
      }
    }
    if (!this.session) {
      this.emit(IPC.evAgent, {
        type: 'error',
        message: 'No conversation open.',
      } satisfies AgentEventDto);
      return;
    }
    // The first message gives the conversation its title: a menu where
    // everything is called "New conversation" is useless.
    await this.titleFromFirstMessage(text);

    try {
      for await (const event of this.session.send(text)) {
        switch (event.type) {
          case 'token':
            this.emit(IPC.evAgent, {
              type: 'token',
              text: event.text,
            } satisfies AgentEventDto);
            break;
          case 'thinking':
            this.emit(IPC.evAgent, {
              type: 'thinking',
              text: event.text,
            } satisfies AgentEventDto);
            break;
          case 'tool_call':
            this.emit(IPC.evAgent, {
              type: 'tool_call',
              name: event.name,
              args: event.args,
            } satisfies AgentEventDto);
            break;
          case 'tool_result':
            this.emit(IPC.evAgent, {
              type: 'tool_result',
              name: event.name,
              ok: event.ok,
              content: event.content,
            } satisfies AgentEventDto);
            break;
          case 'turn_end':
            this.emit(IPC.evAgent, {
              type: 'done',
              stats: {
                promptMs: event.promptMs,
                promptUncachedTokens: 0,
                predictedTokens: 0,
                predictedMs: 0,
              },
            } satisfies AgentEventDto);
            break;
          case 'error':
            this.emit(IPC.evAgent, {
              type: 'error',
              message: event.message,
            } satisfies AgentEventDto);
            break;
          default:
            break; // log mutations: persisted by the session
        }
      }
    } catch (error) {
      this.emit(IPC.evAgent, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      } satisfies AgentEventDto);
    }
  }

  async saveKv(): Promise<boolean> {
    if (!this.session) return false;
    try {
      return await this.session.save();
    } catch (error) {
      console.error('[kv] save failed:', error);
      return false;
    }
  }

  async shutdown(): Promise<void> {
    await this.saveKv();
    // Plugins first: they hold dev servers, a shell, a native view. All of
    // that must go down with the app, not outlive it.
    await this.pluginHost.deactivateAll().catch(() => undefined);
    this.unsubscribeEngineStatus();
    await this.supervisor.stop();
  }

  async suggestSetup(): Promise<SetupSuggestionDto> {
    const env = createSystemDoctorEnv();
    const binPath =
      (await env.lookupOnPath('llama-server')) ??
      (await env.lookupOnPath('llama'));
    return binPath ? { binPath } : {};
  }

  async scanModelInventory(): Promise<ModelInfoDto[]> {
    return scanModels(defaultScanRoots());
  }

  /** Checks that a llama-server actually responds at this URL (remote mode). */
  async probeEndpointUrl(url: string): Promise<EndpointProbeDto | null> {
    return probeEndpoint(url);
  }

  /**
   * The user's language, as the renderer detected or chose it. French is
   * the fallback the reply language already assumed before the renderer
   * started pushing its locale at startup.
   */
  private async locale(): Promise<BonaparteLocale> {
    return (await this.loadConfig()).locale ?? 'fr';
  }

  async pickFile(kind: PickFileKind): Promise<string | null> {
    if (!this.window) return null;
    // The OS dialog shows these names: localised like the rest of the UI.
    const t = harnessT(await this.locale()).dialogs;
    const filters =
      kind === 'gguf'
        ? [
            { name: t.ggufModel, extensions: ['gguf'] },
            { name: t.allFiles, extensions: ['*'] },
          ]
        : process.platform === 'win32'
          ? [
              { name: t.executable, extensions: ['exe'] },
              { name: t.allFiles, extensions: ['*'] },
            ]
          : [{ name: t.allFiles, extensions: ['*'] }];
    const result = await dialog.showOpenDialog(this.window, {
      properties: ['openFile'],
      filters,
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  registerIpc(ipcMain: IpcMain, appVersion: string): void {
    ipcMain.handle(IPC.appVersion, () => appVersion);
    ipcMain.handle(IPC.configGet, () => this.loadConfig());
    ipcMain.handle(IPC.configSet, (_e, config: AppConfigDto) =>
      this.saveConfig(config),
    );
    ipcMain.handle(IPC.backendStatus, () => this.status());
    ipcMain.handle(IPC.backendStart, (_e, config: BackendConfigDto) =>
      this.startEngine(config),
    );
    ipcMain.handle(IPC.backendRegister, (_e, config: BackendConfigDto) =>
      this.registerEngine(config),
    );
    ipcMain.handle(IPC.conversationHistory, (_e, select?: string) =>
      this.conversationHistory(select),
    );
    ipcMain.handle(IPC.conversationList, () => this.listConversations());
    ipcMain.handle(IPC.pluginsList, () => this.listPlugins());
    ipcMain.handle(IPC.pluginsReload, () => this.reloadPlugins());
    ipcMain.handle(
      IPC.pluginsAck,
      (_e, pluginId: string, instanceId: string, bytes: number) => {
        this.pluginHost.acknowledge(pluginId, instanceId, bytes);
      },
    );
    ipcMain.handle(
      IPC.pluginsInvoke,
      (_e, pluginId: string, command: string, payload?: unknown) =>
        this.pluginHost.invoke(pluginId, command, payload),
    );
    ipcMain.handle(IPC.settingsGet, (_e, scope: SettingScopeDto) => this.getSettings(scope));
    ipcMain.handle(IPC.settingsSet, (_e, scope: SettingScopeDto, key: string, value: unknown) =>
      this.setSetting(scope, key, value),
    );
    ipcMain.handle(IPC.conversationCreate, (_e, projectRoot?: string) =>
      this.createConversation(projectRoot),
    );
    ipcMain.handle(IPC.conversationRename, (_e, id: string, title: string) =>
      this.renameConversation(id, title),
    );
    ipcMain.handle(
      IPC.conversationOpen,
      (_e, id?: string, modelPath?: string) => this.openConversation(id, modelPath),
    );
    ipcMain.handle(IPC.agentSend, (_e, text: string) => this.send(text));
    ipcMain.handle(IPC.kvSave, () => this.saveKv());
    ipcMain.handle(IPC.setupSuggest, () => this.suggestSetup());
    ipcMain.handle(IPC.modelsScan, () => this.scanModelInventory());
    ipcMain.handle(IPC.endpointProbe, (_e, url: string) => this.probeEndpointUrl(url));
    ipcMain.handle(IPC.dialogPickFile, (_e, kind: PickFileKind) =>
      this.pickFile(kind),
    );
    ipcMain.handle(IPC.projectOpen, () => this.openProject());
    ipcMain.handle(IPC.projectCurrent, () => this.currentProject());
    ipcMain.handle(IPC.projectsList, () => this.listProjects());
    ipcMain.handle(IPC.projectCreate, (_e, name: string, roots?: string[]) =>
      this.createProject(name, roots),
    );
    ipcMain.handle(IPC.projectRename, (_e, id: string, name: string) =>
      this.renameProject(id, name),
    );
    ipcMain.handle(IPC.projectSetRoots, (_e, id: string, roots: string[]) =>
      this.setProjectRoots(id, roots),
    );
    ipcMain.handle(IPC.projectRemove, (_e, id: string) => this.removeProject(id));
    ipcMain.handle(IPC.dialogPickDirectory, () => this.pickDirectory());
    ipcMain.handle(
      IPC.conversationSetProject,
      (_e, conversationId: string, projectId: string | null) =>
        this.setConversationProject(conversationId, projectId),
    );
    ipcMain.handle(IPC.modeGet, () => this.getMode());
    ipcMain.handle(IPC.modeSet, (_e, mode: PlayModeDto) => this.setMode(mode));
    ipcMain.handle(IPC.approvalRespond, (_e, response: ApprovalResponseDto) =>
      this.respondToApproval(response),
    );
    ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
      if (!EXTERNAL_URL_ALLOWLIST.some((re) => re.test(url))) {
        throw new Error(`External URL refused: ${url}`);
      }
      await shell.openExternal(url);
    });
  }
}
