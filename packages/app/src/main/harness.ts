/**
 * Bridge between @aparte/bonaparte-core and Electron: the active chat
 * session, the app config, the window and its dialogs. The engine's life
 * cycle belongs to core's `EngineSupervisor`; the model is not a parameter of
 * the engine — each conversation pins its own, and the managed server is
 * (re)started with the model of the active conversation. All business logic
 * lives in core — here, only wiring.
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  assertLlamaBinary,
  bonaparteDataDir,
  builtinTools,
  validateSettingValue,
  alwaysRule,
  commandBinary,
  ConversationEngine,
  ConversationStore,
  createWindowsProbes,
  nodeSystemProbe,
  ResourceMonitor,
  createSystemDoctorEnv,
  defaultScanRoots,
  EngineSupervisor,
  enforceRetention,
  estimateLoad,
  estimateSwitch,
  memoryVerdict,
  readGgufInfo,
  readProjectInstructions,
  previewToolCall,
  CheckpointStore,
  GrantStore,
  HARNESS_SETTINGS,
  APP_SETTINGS,
  CONTEXT_SETTINGS,
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
  type GgufInfo,
  type KvCacheType,
  type PlayMode,
  type PluginNodeModule,
  type SamplingParams,
  type SettingField,
  type SettingLayers,
  type Opened,
  type TaggedEvent,
  harnessT,
} from '@aparte/bonaparte-core';
import {
  IPC,
  type AgentEventBodyDto,
  type AgentEventDto,
  type AppConfigDto,
  type ApprovalRequestDto,
  type ApprovalResponseDto,
  type BackendConfigDto,
  type BackendStatusDto,
  type ConversationSummaryDto,
  type ConversationOpenReplyDto,
  type EndpointProbeDto,
  type ModelMemoryDto,
  type SwitchEstimateDto,
  type GrantDto,
  type KvUsageDto,
  type ModelInfoDto,
  type PickFileKind,
  type PlayModeDto,
  type PluginStatusDto,
  type ProjectDto,
  type ProjectSummaryDto,
  type ResourceSampleDto,
  type ResolvedSettingDto,
  type SettingScopeDto,
  type SetupSuggestionDto,
  type BonaparteLocale,
} from '@aparte/bonaparte-shared';
import { Notification, app, dialog, powerMonitor, shell } from 'electron';
import type { BrowserWindow, IpcMain } from 'electron';
import { existsSync } from 'node:fs';
import { resolvePluginsDir } from './plugins-dir.js';

/** Global settings that are launch parameters of the engine (D-17). */
const LAUNCH_KEYS = new Set(['nCtx', 'cacheType', 'nGpuLayers']);

/** Text files joined to one message: how many, and how large each (characters). */
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_CHARS = 256 * 1024;

/** Only external destinations allowed from the renderer. */
const EXTERNAL_URL_ALLOWLIST = [/^https:\/\/github\.com\/ggml-org\/llama\.cpp(\/|$)/];

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
    beforeUnload: () => this.conversations.saveState().then(() => undefined),
  });
  private readonly unsubscribeEngineStatus = this.supervisor.onStatusChange((status) => {
    this.emit(IPC.evBackendStatus, status);
    // A model just loaded: arm the inactivity timer. A stop clears it.
    if (status === 'ready') void this.armIdleTimer();
    else if (status === 'stopped' || status === 'crashed') this.clearIdleTimer();
  });

  /** Notify when a turn ends while the window is not in front. Cached from the settings. */
  private notifyTurnEndCached = true;
  /** How the main process brings the window back (set by index.ts: the tray knows how). */
  private showWindow: () => void = () => undefined;
  setShowWindow(show: () => void): void {
    this.showWindow = show;
  }
  /** Closing the window keeps bonaparte in the tray rather than quitting. Cached for the sync close handler. */
  private closeToTrayCached = true;
  get closeToTray(): boolean {
    return this.closeToTrayCached;
  }
  /** UI locale, cached synchronously for the main process (the tray menu). */
  private localeCached: 'fr' | 'en' = 'fr';
  get uiLocale(): 'fr' | 'en' {
    return this.localeCached;
  }
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
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
  /**
   * Plugin settings, by plugin then by key — what `ctx.getConfig()` reads,
   * LIVE. They live in the global settings under `plugin:<id>:<key>` and
   * are mirrored here whenever those change.
   */
  private readonly pluginConfig: Record<string, Record<string, unknown>> = {};
  private readonly pluginHost = new PluginHost({
    registry: this.registry,
    config: this.pluginConfig,
    logger: (message) => console.log(message),
    // `core` doesn't know about Electron: this is where a plugin event
    // becomes an IPC message to the window.
    emit: (pluginId, instanceId, event, payload) => {
      this.emit(IPC.evPlugin, { pluginId, instanceId, event, payload });
    },
  });
  /**
   * What "always allow" granted, per project, on disk (P1.8). The engine
   * reads the grants of the project whose conversation holds the slot —
   * the one whose turn is asking — on every tool call.
   */
  private readonly grants = new GrantStore(join(bonaparteDataDir(), 'config'));
  /** Project of each conversation seen, kept by `rootsOf`: the rules provider is synchronous. */
  private readonly projectOf = new Map<string, string | undefined>();
  private activeProject(): string | undefined {
    const active = this.conversationsEngine?.active;
    return active ? this.projectOf.get(active) : undefined;
  }
  private readonly permissions = new PermissionEngine('repetition', () =>
    this.grants.rulesFor(this.activeProject()),
  );
  private readonly pendingApprovals = new Map<
    string,
    {
      resolve: (granted: boolean) => void;
      request: { tool: string; command?: string };
    }
  >();
  /**
   * The open conversation lives in core: the slot, the session, the turn in
   * flight. The harness only resolves what a session needs from the app's
   * config — the project's roots, the reply language, sampling, reasoning —
   * and turns core's events into IPC messages. Built on first use: it reads
   * fields declared further down the class.
   */
  private conversationsEngine: ConversationEngine | null = null;
  private get conversations(): ConversationEngine {
    if (this.conversationsEngine) return this.conversationsEngine;
    const engine = new ConversationEngine({
      store: this.store,
      kv: this.kv,
      registry: this.registry,
      permissions: this.permissions,
      supervisor: this.supervisor,
      defaultModel: async () => (await this.loadConfig()).defaultModel?.path,
      rootsOf: (id) => this.rootsOf(id),
      context: async (conversationId) => ({
        // The thread is in English; only the reply language follows the user.
        replyLanguage: (await this.loadConfig()).locale === 'en' ? 'English' : 'French',
        // The repository's conventions: frozen at the first open, a change
        // appended as a message (never re-rendered).
        ...(await this.instructionsFor(conversationId)),
        sampling: await this.currentSampling(),
        thinking: await this.currentThinking(),
        ...(await this.currentContextLimit()),
      }),
      approve: this.approve,
      logger: (line) => console.log(line),
      checkpoints: this.checkpoints,
    });
    engine.onEvent((event) => this.forwardAgentEvent(event));
    this.conversationsEngine = engine;
    return engine;
  }

  /** What each turn wrote, kept to be undone (06 §1 D) — in the app's data, never in the repository. */
  private readonly checkpoints = new CheckpointStore(join(bonaparteDataDir(), 'checkpoints'));
  /** The saved contexts' disk budget, from the settings (read at every save). */
  private kvBudgetBytes = 16 * 1024 ** 3;
  private readonly kv = new KvStore(kvSlotsDir(), {
    budgetBytes: () => this.kvBudgetBytes,
    onRetention: (report) =>
      console.log(
        `[kv] retention: ${report.evicted.length} state(s) dropped (${report.evicted.join(', ') || 'none'}), ` +
          `${(report.totalBytes / 1024 ** 3).toFixed(1)} GB of ${(report.budgetBytes / 1024 ** 3).toFixed(1)} GB` +
          (report.overBudget ? ' — the open conversation alone exceeds the budget' : ''),
      ),
  });
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

  /**
   * What the machine is doing: CPU and RAM from Node, GPU and the server's
   * footprint from Windows' counters, bonaparte's own processes from
   * Electron. Sampled every few seconds, shown in the status strip.
   */
  private readonly machineProbes = createWindowsProbes({
    serverPid: () => this.supervisor.serverPid,
  });
  private readonly resources = new ResourceMonitor({
    intervalMs: 3000,
    system: nodeSystemProbe,
    gpu: this.machineProbes.gpu,
    serverProcess: this.machineProbes.serverProcess,
    app: () => {
      try {
        const metrics = app.getAppMetrics();
        return {
          workingSetBytes: metrics.reduce((sum, m) => sum + m.memory.workingSetSize * 1024, 0),
          cpu: Math.round(metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0) * 10) / 10,
        };
      } catch {
        return null;
      }
    },
  });

  attachWindow(window: BrowserWindow): void {
    this.window = window;
    this.resources.onSample((sample) =>
      this.emit(IPC.evResources, sample satisfies ResourceSampleDto),
    );
    this.resources.start();
  }

  /** Restores project and mode from config at startup. */
  async restoreSession(): Promise<void> {
    // First of all: a server left behind by a session that died abruptly.
    await this.supervisor.killOrphan();
    await this.grants.load();
    await this.purgeLegacyConversations();
    await this.loadPlugins();
    const config = await this.loadConfig();
    this.syncPluginConfig(config.settings);
    // We reopen the last conversation, and it is THAT conversation that says
    // whether there is a project. Nothing is loaded into VRAM here: only meta.
    if (config.currentConversationId && (await this.store.exists(config.currentConversationId))) {
      this.currentConversationId = config.currentConversationId;
      this.roots = await this.rootsOf(config.currentConversationId);
    }
    this.registerBuiltinTools();
    if (config.mode) this.permissions.setMode(config.mode as PlayMode);
    await this.refreshAppBehaviour();
  }

  /**
   * Application behaviour, resolved from the global settings: whether the
   * window closes to the tray, and whether an idle model unloads itself.
   */
  private async refreshAppBehaviour(): Promise<void> {
    const resolved = resolveSettings(APP_SETTINGS, await this.settingLayers(), 'global');
    const value = (key: string): unknown => resolved.find((setting) => setting.key === key)?.value;
    this.closeToTrayCached = value('closeToTray') !== false;
    this.notifyTurnEndCached = value('notifyTurnEnd') !== false;
    const budget = value('kvBudgetGb');
    this.kvBudgetBytes = (typeof budget === 'number' && budget > 0 ? budget : 16) * 1024 ** 3;
    this.localeCached = (await this.loadConfig()).locale === 'en' ? 'en' : 'fr';
    // Re-arming reads the new idle config (it may have just changed).
    if (this.supervisor.loaded) await this.armIdleTimer();
    else this.clearIdleTimer();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Arms (or re-arms) the inactivity timer. When it fires with nothing in
   * flight, the active conversation's state is saved and the model is
   * unloaded — its memory freed, the next message reloading it. The way LM
   * Studio's idle TTL and Ollama's keep_alive behave.
   */
  private async armIdleTimer(): Promise<void> {
    this.clearIdleTimer();
    const resolved = resolveSettings(APP_SETTINGS, await this.settingLayers(), 'global');
    const value = (key: string): unknown => resolved.find((setting) => setting.key === key)?.value;
    if (value('idleUnload') === false) return;
    const minutes = typeof value('idleUnloadMinutes') === 'number' ? (value('idleUnloadMinutes') as number) : 15;
    this.idleTimer = setTimeout(() => void this.onIdle(), Math.max(1, minutes) * 60_000);
    this.idleTimer.unref?.();
  }

  /**
   * The computer goes to sleep: a model held in memory through a long sleep
   * is waste, and some GPUs wake badly. Same path as idleness — the state is
   * saved, the model unloaded, the next message reloads it — under the same
   * setting.
   */
  watchPower(): void {
    powerMonitor.on('suspend', () => void this.onSuspend());
  }

  private async onSuspend(): Promise<void> {
    const resolved = resolveSettings(APP_SETTINGS, await this.settingLayers(), 'global');
    if (resolved.find((setting) => setting.key === 'idleUnload')?.value === false) return;
    if (!this.supervisor.loaded || this.conversations.inFlight()) return;
    console.log('[power] going to sleep: saving the conversation state and unloading the model');
    await this.conversations.saveState().catch(() => undefined);
    await this.supervisor.stop().catch(() => undefined);
  }

  /**
   * A turn ended while bonaparte is not in front: a local model takes
   * minutes, and whoever went elsewhere should know when to come back. A
   * click shows the window on that conversation. E2E records instead of
   * notifying (its window is never in front).
   */
  private async notifyIfAway(conversationId: string, outcome: 'done' | 'error'): Promise<void> {
    if (!this.notifyTurnEndCached) return;
    const win = this.window;
    if (!win || win.isDestroyed() || (win.isVisible() && win.isFocused())) return;
    const t = harnessT(this.localeCached).notifications;
    const title = (await this.store.meta(conversationId).catch(() => null))?.title || t.untitled;
    const body = (outcome === 'done' ? t.replyReady : t.replyFailed).replace('{title}', () => title);
    if (process.env['BONAPARTE_E2E']) {
      const scope = globalThis as { __bonaparteNotifications?: { conversationId: string; body: string }[] };
      (scope.__bonaparteNotifications ??= []).push({ conversationId, body });
      return;
    }
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: 'bonaparte', body });
    notification.on('click', () => {
      this.showWindow();
      this.emit(IPC.evNavigate, conversationId);
    });
    notification.show();
  }

  private async onIdle(): Promise<void> {
    this.idleTimer = null;
    // A turn in flight is activity: leave the model be, and look again later.
    if (this.conversations.inFlight()) {
      await this.armIdleTimer();
      return;
    }
    if (!this.supervisor.loaded) return;
    console.log('[idle] no activity: saving the conversation state and unloading the model');
    await this.conversations.saveState().catch(() => undefined);
    // Stopping the server frees the model; the status change tells the UI,
    // and the next message brings it back up (with its state restored).
    await this.supervisor.stop().catch(() => undefined);
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
    this.projectOf.set(conversationId, projectId);
    if (!projectId) return [];
    return (await this.projects.get(projectId))?.roots ?? [];
  }

  /** The project's instruction files, as the prompt carries them. */
  private async instructionsFor(conversationId: string): Promise<{ projectInstructions?: string }> {
    const roots = await this.rootsOf(conversationId).catch(() => []);
    const found = await readProjectInstructions(roots);
    return found ? { projectInstructions: found.text } : {};
  }

  /** A project as the renderer lists it, with the instruction files the model reads. */
  private async projectSummary(project: { id: string; name: string; roots: string[] }): Promise<ProjectSummaryDto> {
    const found = await readProjectInstructions(project.roots);
    return {
      id: project.id,
      name: project.name,
      roots: project.roots,
      ...(found ? { instructions: found.sources } : {}),
    };
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
    const titles = new Map(metas.map((meta) => [meta.id, meta.title]));
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
        ...(meta.pinned ? { pinned: true } : {}),
        ...(meta.archived ? { archived: true } : {}),
        ...(meta.parentId
          ? { parentId: meta.parentId, ...(titles.has(meta.parentId) ? { parentTitle: titles.get(meta.parentId) as string } : {}) }
          : {}),
      })),
    );
  }

  async markConversation(id: string, marks: { pinned?: boolean; archived?: boolean }): Promise<void> {
    const clean: { pinned?: boolean; archived?: boolean } = {};
    if (typeof marks?.pinned === 'boolean') clean.pinned = marks.pinned;
    if (typeof marks?.archived === 'boolean') clean.archived = marks.archived;
    await this.store.setMarks(id, clean);
  }

  /** Compaction = rebase (P2.5): core summarises, appends the rebase, resets the freeze. */
  async compactConversation(id: string): Promise<{ compactedTurns: number; keptTurns: number }> {
    void this.armIdleTimer();
    const result = await this.conversations.compact(id);
    return { compactedTurns: result.compactedTurns, keptTurns: result.keptTurns };
  }

  /** A branch (or a duplicate): core copies the frozen prompt, the log up to the turn, and the saved state. */
  async branchConversation(id: string, options: { title: string; afterTurn?: number }): Promise<string> {
    if (typeof options?.title !== 'string' || options.title.length > 300) throw new Error('A branch needs a title');
    const afterTurn = options.afterTurn;
    if (afterTurn !== undefined && !(Number.isInteger(afterTurn) && afterTurn >= 0)) {
      throw new Error(`Not a turn: ${String(afterTurn)}`);
    }
    const newId = newConversationId();
    await this.conversations.branch(id, newId, {
      title: options.title,
      ...(afterTurn !== undefined ? { afterTurn } : {}),
    });
    return newId;
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

  /**
   * Erases a conversation — log, meta, saved state (core cuts a turn in
   * flight there first). The open one is forgotten as current: the screen
   * asks for the history again and lands on another conversation.
   */
  async deleteConversation(id: string): Promise<void> {
    await this.conversations.remove(id);
    if (this.currentConversationId === id) {
      this.currentConversationId = null;
      this.roots = [];
      const { currentConversationId: _dropped, ...config } = await this.loadConfig();
      await this.saveConfig(config);
    }
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
    void this.conversations.close();
    return this.listPlugins();
  }

  /**
   * Discovers then activates plugins. A plugin that fails is KEPT along with
   * its error — the Settings hub must be able to show it rather than making
   * it disappear without explanation.
   */
  async loadPlugins(): Promise<void> {
    // Switched off in the hub: discovered and listed, never activated.
    for (const id of (await this.loadConfig()).disabledPlugins ?? []) this.pluginHost.setEnabled(id, false);
    const found = await this.pluginHost.discover(this.pluginsDir());
    for (const plugin of found) await this.activatePlugin(plugin.id);
  }

  /** Imports a discovered plugin's Node half and activates it (a switched-off one stays off). */
  private async activatePlugin(id: string): Promise<void> {
    const plugin = this.pluginHost.get(id);
    if (!plugin?.manifest || plugin.error) return;
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

  /**
   * Switches a plugin on or off, live (P3.2): the host is reversible, so
   * off tears everything it registered down, on activates it again. The
   * choice is remembered; the conversation learns of its tools by a delta.
   */
  async setPluginEnabled(id: string, enabled: boolean): Promise<PluginStatusDto[]> {
    if (typeof id !== 'string' || !this.pluginHost.get(id)) throw new Error(`Unknown plugin: ${String(id)}`);
    const config = await this.loadConfig();
    const disabled = new Set(config.disabledPlugins ?? []);
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    await this.saveConfig({ ...config, disabledPlugins: [...disabled] });
    this.pluginHost.setEnabled(id, enabled === true);
    if (enabled) await this.activatePlugin(id);
    else await this.pluginHost.deactivate(id);
    this.registerBuiltinTools();
    void this.conversations.close();
    return this.listPlugins();
  }

  listPlugins(): PluginStatusDto[] {
    return this.pluginHost.status();
  }

  // ── Settings ───────────────────────────────────────────────────────────

  /** Harness fields plus those contributed by active plugins. */
  private settingFields(): SettingField[] {
    // A plugin's settings sit next to the harness's, namespaced by plugin:
    // one catalog, one resolver, one form.
    const fromPlugins = this.pluginHost
      .status()
      .filter((plugin) => plugin.active)
      .flatMap((plugin) =>
        plugin.configSchemas.map(
          (field): SettingField => ({
            key: `plugin:${plugin.id}:${field.key}`,
            label: field.label,
            type: field.type,
            scopes: field.scopes,
            ...(field.options ? { options: field.options } : {}),
            ...(field.description ? { description: field.description } : {}),
            ...(field.default !== undefined ? { default: field.default } : {}),
            ...(field.secret ? { secret: true } : {}),
            // The dependency keys are namespaced too, so the form matches them
            // against the plugin's own settings.
            ...(field.showFor
              ? {
                  showFor: Object.fromEntries(
                    Object.entries(field.showFor).map(([key, values]) => [
                      `plugin:${plugin.id}:${key}`,
                      values,
                    ]),
                  ),
                }
              : {}),
          }),
        ),
      );
    return [...HARNESS_SETTINGS, ...fromPlugins];
  }

  /** Mirrors the `plugin:<id>:<key>` entries of the global settings into what the host serves plugins. */
  private syncPluginConfig(settings: Record<string, unknown> | undefined): void {
    for (const id of Object.keys(this.pluginConfig)) delete this.pluginConfig[id];
    for (const [key, value] of Object.entries(settings ?? {})) {
      const match = /^plugin:([^:]+):(.+)$/.exec(key);
      if (!match) continue;
      (this.pluginConfig[match[1]!] ??= {})[match[2]!] = value;
    }
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
      ...(setting.field.secret ? { secret: true } : {}),
      ...(setting.field.showFor ? { showFor: setting.field.showFor } : {}),
      value: setting.value,
      from: setting.from,
      overridden: setting.overridden,
      // The UI must warn BEFORE the change, not observe it after the fact.
      invalidatesKv: KV_INVALIDATING_KEYS.has(setting.key),
    }));
  }

  async setSetting(scope: SettingScopeDto, key: string, value: unknown): Promise<void> {
    // A known key, in a scope it has, with a value of its type — the engine
    // and the plugins read what lands here.
    validateSettingValue(this.settingFields(), scope, key, value);
    if (scope === 'conversation') {
      const id = this.currentConversationId;
      if (!id) return;
      await this.store.setSetting(id, key, value);
      // The session carries the sampling params: it is reopened on the next
      // message with the new values — once the turn in flight, if any, ends.
      void this.conversations.close();
      return;
    }
    const config = await this.loadConfig();
    const settings = { ...(config.settings ?? {}) };
    if (value === undefined) delete settings[key];
    else settings[key] = value;
    await this.saveConfig({ ...config, settings });
    this.syncPluginConfig(settings);
    await this.refreshAppBehaviour();
    if (LAUNCH_KEYS.has(key) && config.backend) {
      // The server no longer matches its parameters: it goes down now (its
      // state saved first) and the next message brings it up with the new
      // ones. Saved states whose context size differs are refused by the
      // manifest and announced as a re-prefill.
      await this.conversations.close();
      await this.supervisor.configure(await this.engineConfig(config.backend));
      return;
    }
    void this.conversations.close();
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
    if (config.mode === 'remote') {
      if (!/^https?:\/\//i.test(config.url)) throw new Error(`Not an http(s) URL: ${config.url}`);
      return { mode: 'remote', url: config.url };
    }
    // The renderer names the binary we are about to execute (audit 07,
    // finding 3): a llama.cpp server, never an arbitrary program.
    assertLlamaBinary(config.binPath);
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

  /** The cap the open conversation puts on its own context, when switched on. */
  private async currentContextLimit(): Promise<{ contextLimit?: number }> {
    const resolved = resolveSettings(CONTEXT_SETTINGS, await this.settingLayers(), 'conversation');
    const enabled = resolved.find((setting) => setting.key === 'contextLimitEnabled')?.value === true;
    const limit = resolved.find((setting) => setting.key === 'contextLimit')?.value;
    return enabled && typeof limit === 'number' && limit > 0 ? { contextLimit: limit } : {};
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
    return Promise.all((await this.projects.list()).map((project) => this.projectSummary(project)));
  }

  async createProject(name: string, roots: string[] = []): Promise<ProjectSummaryDto> {
    return this.projectSummary(await this.projects.create({ name, roots }));
  }

  async renameProject(id: string, name: string): Promise<ProjectSummaryDto> {
    const project = await this.projects.rename(id, name);
    await this.refreshRoots();
    return this.projectSummary(project);
  }

  async setProjectRoots(id: string, roots: string[]): Promise<ProjectSummaryDto> {
    const project = await this.projects.setRoots(id, roots);
    // The scope has changed: the ongoing session carries the old one, it must
    // be rebuilt so the delta gets announced to the model on reopening.
    await this.refreshRoots();
    return this.projectSummary(project);
  }

  async removeProject(id: string): Promise<void> {
    // The project's conversations are NOT deleted: they become "without a
    // project", hence without confinement. Losing a folder must never mean
    // losing a history.
    for (const meta of await this.store.listMeta()) {
      if (meta.projectId === id) await this.store.setProjectId(meta.id, undefined);
    }
    await this.projects.remove(id);
    // Its grants go with it: they answered for its folders only.
    await this.grants.dropProject(id);
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
    void this.conversations.close();
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
    void this.conversations.close();
    this.registerBuiltinTools();

    const config = await this.loadConfig();
    const recents = [picked, ...(config.recentProjects ?? []).filter((p) => p !== picked)]
      .slice(0, 8);
    await this.saveConfig({ ...config, recentProjects: recents });
    return this.project(recents);
  }

  async listGrants(): Promise<GrantDto[]> {
    const names = new Map((await this.projects.list()).map((project) => [project.id, project.name]));
    return this.grants.all().map(({ projectId, rule }) => ({
      ...(projectId ? { projectId } : {}),
      ...(projectId && names.has(projectId) ? { projectName: names.get(projectId) as string } : {}),
      tool: rule.tool,
      ...(rule.commandPrefix !== undefined ? { commandPrefix: rule.commandPrefix } : {}),
      ...(rule.exactCommand !== undefined ? { exactCommand: rule.exactCommand } : {}),
    }));
  }

  async revokeGrant(grant: GrantDto): Promise<void> {
    if (typeof grant?.tool !== 'string') throw new Error('Not a grant');
    await this.grants.revoke(grant.projectId, {
      tool: grant.tool,
      ...(typeof grant.commandPrefix === 'string' ? { commandPrefix: grant.commandPrefix } : {}),
      ...(typeof grant.exactCommand === 'string' ? { exactCommand: grant.exactCommand } : {}),
    });
  }

  getMode(): PlayModeDto {
    return this.permissions.getMode();
  }

  async setMode(mode: PlayModeDto): Promise<void> {
    this.permissions.setMode(mode as PlayMode);
    const config = await this.loadConfig();
    await this.saveConfig({ ...config, mode });
  }

  /**
   * Asks for the user's consent; resolved by respondToApproval. A file write
   * comes with its diff against the disk: the change is what is signed, not
   * the path (06 §2).
   */
  private readonly approve = async (request: {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    command?: string;
  }): Promise<boolean> => {
    const active = this.conversations.active;
    const roots = active ? await this.rootsOf(active).catch(() => []) : [];
    const preview = await previewToolCall(request.tool, request.args, roots).catch(() => undefined);
    return new Promise<boolean>((resolve) => {
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
      const binary = request.command !== undefined ? commandBinary(request.command) : undefined;
      this.emit(IPC.evApproval, {
        ...request,
        conversationId: this.conversations.active ?? '',
        ...(binary ? { binary } : {}),
        ...(preview ? { preview } : {}),
      } satisfies ApprovalRequestDto);
    });
  };

  async respondToApproval(response: ApprovalResponseDto): Promise<void> {
    const pending = this.pendingApprovals.get(response.id);
    if (!pending) return;
    this.pendingApprovals.delete(response.id);

    // The turn waits on this answer: it is given first, whatever happens to
    // the grant's write — a disk error (a rename refused on Windows) left
    // the turn hanging on a question already answered.
    pending.resolve(response.granted);
    if (response.granted && response.always) {
      // "Always allow" says what it covers (Q-24, audit C1): the exact line,
      // or every command of a plain-named program — never a first word
      // that happened to start a longer line.
      // Remembered for the project of the conversation that asked, on disk.
      try {
        await this.grants.add(
          this.activeProject(),
          alwaysRule(pending.request.tool, pending.request.command, response.always === 'binary' ? 'binary' : 'command'),
        );
      } catch (error) {
        console.error('[permissions] the grant could not be saved:', error instanceof Error ? error.message : error);
      }
    }
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
    // The session, if any, is bound to the server going down: saved first.
    await this.conversations.close();
    await this.supervisor.configure(await this.engineConfig(config));
  }

  /**
   * Remote: immediate connection. Managed: the server starts with the first
   * conversation that names a model. The engine config is saved here, once
   * it registered (and connected, for a remote one) — not by the renderer.
   */
  async startEngine(config: BackendConfigDto): Promise<BackendStatusDto> {
    await this.registerEngine(config);
    if (config.mode === 'remote') await this.supervisor.connect();
    const saved = await this.loadConfig();
    await this.saveConfig({ ...saved, backend: config });
    return this.status();
  }

  /** The model new conversations start on — chosen in the picker. */
  async setDefaultModel(modelPath: string): Promise<void> {
    if (typeof modelPath !== 'string' || !/\.gguf$/i.test(modelPath)) {
      throw new Error(`Not a GGUF model: ${String(modelPath)}`);
    }
    const config = await this.loadConfig();
    await this.saveConfig({ ...config, defaultModel: { path: modelPath } });
  }

  /** The UI language — and with it the language the model replies in. */
  async setLocale(locale: BonaparteLocale): Promise<void> {
    if (locale !== 'fr' && locale !== 'en') throw new Error(`Unknown locale: ${String(locale)}`);
    const config = await this.loadConfig();
    if (config.locale === locale) return;
    await this.saveConfig({ ...config, locale });
    // The tray menu reads it; the next session opens with the new reply language.
    await this.refreshAppBehaviour();
    void this.conversations.close();
  }

  async openConversation(id?: string, modelPath?: string): Promise<ConversationOpenReplyDto> {
    id ??= await this.ensureConversationId();
    // "Current" first: the built-in tools and the roots follow it, and the
    // session opened next reads them.
    if (await this.store.exists(id)) await this.setCurrentConversation(id);
    const outcome = await this.conversations.open(id, modelPath);
    if ('needsModel' in outcome) return outcome;
    await this.setCurrentConversation(id);
    return this.openedDto(outcome);
  }

  private openedDto(opened: Opened): ConversationOpenReplyDto {
    return {
      conversationId: opened.conversationId,
      modelPath: opened.modelPath,
      modelName: modelDisplayName(opened.modelPath),
      // Denominator of the context gauge: what the server holds.
      ...(opened.nCtx !== undefined ? { nCtx: opened.nCtx } : {}),
      contextTokens: opened.contextTokens,
      events: opened.events,
      ...(opened.seed
        ? {
            seed: {
              restored: opened.seed.restored,
              tokens: opened.seed.restored
                ? opened.seed.nRestored
                : opened.seed.created
                  ? opened.seed.nTokens
                  : 0,
            },
          }
        : {}),
      restore: opened.restore.restored
        ? { restored: true, nRestored: opened.restore.nRestored }
        : { restored: false, reason: opened.restore.reason },
    };
  }

  /**
   * History of a conversation WITHOUT touching the engine: launching the app
   * must neither wake a server nor load a model into VRAM. The connection
   * only happens on the first message.
   */
  async conversationHistory(select?: string): Promise<ConversationOpenReplyDto> {
    // Switching conversation is a READ: the history comes from the log on
    // disk, never from the slot. A reply streaming elsewhere keeps streaming
    // — it is persisted by the engine and shown again on return.
    if (select && select !== this.currentConversationId && (await this.store.exists(select))) {
      await this.setCurrentConversation(select);
    }

    let id = this.currentConversationId;
    if (!id || !(await this.store.exists(id))) {
      // A fresh install, or a current conversation deleted behind our back:
      // the screen always shows a conversation, so one exists from the start
      // — empty, which loads nothing. Its id is what every event will name;
      // a screen mounted without one ignored the reply to the first message.
      this.currentConversationId = null;
      id = await this.ensureConversationId();
    }
    const history = await this.conversations.history(id);
    return {
      conversationId: id,
      ...(history.modelPath
        ? {
            modelPath: history.modelPath,
            modelName: modelDisplayName(history.modelPath),
            ...(history.missingModel ? { missingModel: history.missingModel } : {}),
          }
        : {}),
      events: history.events,
      restore: { restored: false, reason: 'not-connected' },
    };
  }

  async send(text: string, attachments?: { name: string; content: string }[]): Promise<void> {
    void this.armIdleTimer();
    const id = await this.ensureConversationId();
    // Joined files, checked at the boundary: a few text files of bounded size.
    const files = Array.isArray(attachments)
      ? attachments
          .filter(
            (file) =>
              typeof file?.name === 'string' &&
              typeof file?.content === 'string' &&
              file.name.length <= 255 &&
              file.content.length <= MAX_ATTACHMENT_CHARS,
          )
          .slice(0, MAX_ATTACHMENTS)
          .map((file) => ({ name: file.name, content: file.content }))
      : [];
    const outcome = await this.conversations.send(id, text, files.length > 0 ? files : undefined);
    if (outcome) {
      // Not an error: a choice to make. The renderer opens the picker and
      // keeps the message for after the pick.
      this.emit(IPC.evAgent, {
        conversationId: outcome.conversationId,
        type: 'needs_model',
        ...(outcome.missingModel ? { missingModel: outcome.missingModel } : {}),
      } satisfies AgentEventDto);
    }
  }

  /** Core's turn events become IPC messages, each naming its conversation. */
  private forwardAgentEvent({ conversationId, event }: TaggedEvent): void {
    let body: AgentEventBodyDto | null = null;
    switch (event.type) {
      case 'token':
        body = { type: 'token', text: event.text };
        break;
      case 'thinking':
        body = { type: 'thinking', text: event.text };
        break;
      case 'tool_call':
        body = { type: 'tool_call', name: event.name, args: event.args };
        break;
      case 'tool_result':
        body = { type: 'tool_result', name: event.name, ok: event.ok, content: event.content };
        break;
      case 'turn_end':
        void this.notifyIfAway(conversationId, 'done');
        body = {
          type: 'done',
          stats: {
            promptMs: event.promptMs,
            promptUncachedTokens: Math.max(0, event.promptTokens - event.cachedTokens),
            predictedTokens: event.predictedTokens,
            predictedMs: 0,
            ...(event.truncated ? { truncated: true } : {}),
            progress: {
              total: event.promptTokens,
              cache: event.cachedTokens,
              processed: event.promptTokens,
              timeMs: event.promptMs,
            },
            contextTokens: event.contextTokens,
          },
        };
        break;
      case 'files_changed':
        body = { type: 'files_changed', turnId: event.turnId, files: event.files };
        break;
      case 'context_overflow':
        body = { type: 'context_overflow', used: event.used, nCtx: event.nCtx, limit: event.limit, needed: event.needed };
        break;
      case 'error':
        void this.notifyIfAway(conversationId, 'error');
        body = { type: 'error', message: event.message };
        break;
      default:
        break; // log mutations: persisted by the session
    }
    if (body) this.emit(IPC.evAgent, { conversationId, ...body } satisfies AgentEventDto);
  }

  async saveKv(): Promise<boolean> {
    return this.conversations.saveState();
  }

  async kvUsage(): Promise<KvUsageDto> {
    const usage = await this.kv.usage();
    return {
      totalBytes: usage.totalBytes,
      budgetBytes: this.kvBudgetBytes,
      conversations: usage.entries.filter((entry) => entry.kind === 'conversation').length,
      seeds: usage.entries.filter((entry) => entry.kind === 'seed').length,
    };
  }

  /** Drops every saved context but the open one's — a cache: the conversations are computed again on resume. */
  async freeKv(): Promise<number> {
    const keep = this.conversationsEngine?.active;
    const report = await enforceRetention(kvSlotsDir(), 0, keep ? [keep] : []);
    return report.evicted.length;
  }

  async shutdown(): Promise<void> {
    // A tool call waiting for consent would hold the turn, and the turn the
    // shutdown: nobody is left to answer, so the answer is no.
    for (const pending of this.pendingApprovals.values()) pending.resolve(false);
    this.pendingApprovals.clear();
    this.clearIdleTimer();
    this.resources.stop();
    this.machineProbes.dispose();
    await this.conversations.close();
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

  /**
   * The models of the machine, each with what it will take in memory at the
   * engine's context — read from its GGUF header, a few at a time.
   */
  async scanModelInventory(): Promise<ModelInfoDto[]> {
    const models = await scanModels(defaultScanRoots());
    const launch = await this.launchSettings();
    const out: ModelInfoDto[] = [];
    for (let i = 0; i < models.length; i += 4) {
      const batch = models.slice(i, i + 4);
      const memories = await Promise.all(
        batch.map((model) => this.memoryOf(model.path, model.sizeBytes, model.modifiedAt, launch)),
      );
      batch.forEach((model, index) => {
        const memory = memories[index];
        out.push({ ...model, ...(memory ? { memory } : {}) });
      });
    }
    return out;
  }

  /** Headers already read, by path — valid while the file keeps its size and date. */
  private readonly ggufInfos = new Map<string, { stamp: string; info: GgufInfo }>();

  private async ggufInfo(modelPath: string, stamp: string): Promise<GgufInfo> {
    const cached = this.ggufInfos.get(modelPath);
    if (cached?.stamp === stamp) return cached.info;
    const info = await readGgufInfo(modelPath);
    this.ggufInfos.set(modelPath, { stamp, info });
    return info;
  }

  /** A model's memory need at the engine's launch settings; undefined when its header cannot be read. */
  private async memoryOf(
    modelPath: string,
    sizeBytes: number,
    modifiedAt: string,
    launch: { nCtx: number; cacheType: KvCacheType },
  ): Promise<ModelMemoryDto | undefined> {
    try {
      const info = await this.ggufInfo(modelPath, `${sizeBytes}:${modifiedAt}`);
      const estimate = estimateLoad(info, sizeBytes, launch.nCtx, launch.cacheType);
      return {
        totalBytes: estimate.totalBytes,
        weightsBytes: estimate.weightsBytes,
        kvBytes: estimate.kvBytes,
        nCtx: launch.nCtx,
        verdict: memoryVerdict(estimate.totalBytes, totalmem()),
        beyondTraining: estimate.beyondTraining,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * What switching a conversation to another model costs (P1.7, D-03): the
   * model read from disk, the conversation's context computed again, the
   * memory — with the durations this machine measured, and only those.
   */
  async estimateModelSwitch(conversationId: string, modelPath: string): Promise<SwitchEstimateDto | null> {
    if (typeof modelPath !== 'string' || !/\.gguf$/i.test(modelPath)) return null;
    let file: { size: number; mtime: Date };
    try {
      file = await stat(modelPath);
    } catch {
      return null;
    }
    const launch = await this.launchSettings();
    const memory = await this.memoryOf(modelPath, file.size, file.mtime.toISOString(), launch);
    if (!memory) return null;
    const contextTokens =
      this.conversations.contextTokensOf(conversationId) ??
      (await this.kv.savedTokens(conversationId)) ??
      (await this.estimateContextFromLog(conversationId));
    const loadSeconds = this.supervisor.loadSeconds(modelPath);
    const prefillTokensPerSecond = this.conversations.prefillRate(modelPath);
    const cost = estimateSwitch({
      load: {
        weightsBytes: memory.weightsBytes,
        kvBytes: memory.kvBytes,
        overheadBytes: memory.totalBytes - memory.weightsBytes - memory.kvBytes,
        totalBytes: memory.totalBytes,
        kvBytesPerToken: 0,
        beyondTraining: memory.beyondTraining,
      },
      contextTokens,
      ...(prefillTokensPerSecond !== undefined ? { prefillTokensPerSecond } : {}),
      ...(loadSeconds !== undefined ? { loadSeconds } : {}),
    });
    return {
      modelPath,
      modelName: modelDisplayName(modelPath),
      memory,
      machineBytes: totalmem(),
      readBytes: cost.readBytes,
      ...(cost.loadSeconds !== undefined ? { loadSeconds: cost.loadSeconds } : {}),
      reprefillTokens: cost.reprefillTokens,
      ...(cost.reprefillSeconds !== undefined ? { reprefillSeconds: cost.reprefillSeconds } : {}),
    };
  }

  /**
   * A conversation's size when nothing measured it: its words, at about
   * 3.5 characters a token, plus the system prompt. An order of magnitude
   * for the announcement — the exact figure is the server's, after.
   */
  private async estimateContextFromLog(conversationId: string): Promise<number> {
    try {
      const events = await this.store.loadEvents(conversationId);
      if (events.length === 0) return 0;
      const chars = events.reduce((sum, event) => sum + JSON.stringify(event).length, 0);
      return Math.round(chars / 3.5) + 600;
    } catch {
      return 0;
    }
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

  /**
   * `isTrusted` says whether a frame URL is the app's own page. Every
   * channel checks it (audit 07, finding 7): the bridge answers the app's
   * top frame, never a page the window was made to show, never a subframe.
   */
  registerIpc(ipcMain: IpcMain, appVersion: string, isTrusted: (frameUrl: string) => boolean): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each channel types its own arguments
    const handle = (channel: string, fn: (...args: any[]) => unknown): void => {
      ipcMain.handle(channel, (event, ...args: unknown[]) => {
        const frame = event.senderFrame;
        if (!frame || frame.parent !== null || !isTrusted(frame.url)) {
          throw new Error(`IPC ${channel} refused from ${frame?.url ?? 'an unknown frame'}`);
        }
        return fn(...args);
      });
    };
    handle(IPC.appVersion, () => appVersion);
    handle(IPC.configGet, () => this.loadConfig());
    handle(IPC.configSetDefaultModel, (modelPath: string) => this.setDefaultModel(modelPath));
    handle(IPC.configSetLocale, (locale: BonaparteLocale) => this.setLocale(locale));
    handle(IPC.backendStatus, () => this.status());
    handle(IPC.backendStart, (config: BackendConfigDto) =>
      this.startEngine(config),
    );
    handle(IPC.backendRegister, (config: BackendConfigDto) =>
      this.registerEngine(config),
    );
    handle(IPC.conversationHistory, (select?: string) =>
      this.conversationHistory(select),
    );
    handle(IPC.conversationList, () => this.listConversations());
    handle(IPC.pluginsList, () => this.listPlugins());
    handle(IPC.pluginsReload, () => this.reloadPlugins());
    handle(IPC.pluginsSetEnabled, (id: string, enabled: boolean) => this.setPluginEnabled(id, enabled === true));
    handle(
      IPC.pluginsAck,
      (pluginId: string, instanceId: string, bytes: number) => {
        this.pluginHost.acknowledge(pluginId, instanceId, bytes);
      },
    );
    handle(
      IPC.pluginsInvoke,
      (pluginId: string, command: string, payload?: unknown) =>
        this.pluginHost.invoke(pluginId, command, payload),
    );
    handle(IPC.settingsGet, (scope: SettingScopeDto) => this.getSettings(scope));
    handle(IPC.settingsSet, (scope: SettingScopeDto, key: string, value: unknown) =>
      this.setSetting(scope, key, value),
    );
    handle(IPC.conversationCreate, (projectRoot?: string) =>
      this.createConversation(projectRoot),
    );
    handle(IPC.conversationRename, (id: string, title: string) =>
      this.renameConversation(id, title),
    );
    handle(IPC.conversationDelete, (id: string) => this.deleteConversation(id));
    handle(IPC.conversationMark, (id: string, marks: { pinned?: boolean; archived?: boolean }) =>
      this.markConversation(id, marks),
    );
    handle(IPC.conversationBranch, (id: string, options: { title: string; afterTurn?: number }) =>
      this.branchConversation(id, options),
    );
    handle(IPC.conversationCompact, (id: string) => this.compactConversation(id));
    handle(IPC.turnUndo, (conversationId: string, turnId: string) =>
      this.conversations.undoTurn(String(conversationId), String(turnId)),
    );
    handle(
      IPC.conversationOpen,
      (id?: string, modelPath?: string) => this.openConversation(id, modelPath),
    );
    handle(IPC.agentSend, (text: string, attachments?: { name: string; content: string }[]) =>
      this.send(text, attachments),
    );
    handle(IPC.kvSave, () => this.saveKv());
    handle(IPC.kvUsage, () => this.kvUsage());
    handle(IPC.kvFree, () => this.freeKv());
    handle(IPC.agentInFlight, () => this.conversations.inFlight());
    handle(IPC.agentCancel, () => {
      if (this.currentConversationId) this.conversations.cancel(this.currentConversationId);
    });
    handle(IPC.setupSuggest, () => this.suggestSetup());
    handle(IPC.modelsScan, () => this.scanModelInventory());
    handle(IPC.modelsEstimateSwitch, (conversationId: string, modelPath: string) =>
      this.estimateModelSwitch(conversationId, modelPath),
    );
    handle(IPC.endpointProbe, (url: string) => this.probeEndpointUrl(url));
    handle(IPC.dialogPickFile, (kind: PickFileKind) =>
      this.pickFile(kind),
    );
    handle(IPC.projectOpen, () => this.openProject());
    handle(IPC.projectCurrent, () => this.currentProject());
    handle(IPC.projectsList, () => this.listProjects());
    handle(IPC.projectCreate, (name: string, roots?: string[]) =>
      this.createProject(name, roots),
    );
    handle(IPC.projectRename, (id: string, name: string) =>
      this.renameProject(id, name),
    );
    handle(IPC.projectSetRoots, (id: string, roots: string[]) =>
      this.setProjectRoots(id, roots),
    );
    handle(IPC.projectRemove, (id: string) => this.removeProject(id));
    handle(IPC.dialogPickDirectory, () => this.pickDirectory());
    handle(
      IPC.conversationSetProject,
      (conversationId: string, projectId: string | null) =>
        this.setConversationProject(conversationId, projectId),
    );
    handle(IPC.grantsList, () => this.listGrants());
    handle(IPC.grantsRevoke, (grant: GrantDto) => this.revokeGrant(grant));
    handle(IPC.modeGet, () => this.getMode());
    handle(IPC.modeSet, (mode: PlayModeDto) => this.setMode(mode));
    handle(IPC.approvalRespond, (response: ApprovalResponseDto) =>
      this.respondToApproval(response),
    );
    handle(IPC.openExternal, async (url: string) => {
      if (!EXTERNAL_URL_ALLOWLIST.some((re) => re.test(url))) {
        throw new Error(`External URL refused: ${url}`);
      }
      await shell.openExternal(url);
    });
  }
}
