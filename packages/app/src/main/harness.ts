/**
 * Bridge between @aparte/bonaparte-core and Electron: owns the ENGINE (managed
 * or remote llama.cpp config), the active chat session, and the app config.
 * The model is not a parameter of the engine: each conversation pins its own,
 * and the managed server is (re)started with the model of the active
 * conversation. All business logic lives in core — here, only wiring.
 */

import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  bonaparteDataDir,
  builtinTools,
  ChatSession,
  ConversationStore,
  createLlamaCppBackend,
  createSystemDoctorEnv,
  defaultScanRoots,
  detectServeCommandPrefix,
  fingerprintModelFile,
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
  type Backend,
  type LiveBackendConfig,
  type PlayMode,
  type PluginNodeModule,
  type ProcessHandle,
  type SamplingParams,
  type SettingField,
  type SettingLayers,
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
} from '@aparte/bonaparte-shared';
import { app, dialog, shell } from 'electron';
import type { BrowserWindow, IpcMain } from 'electron';

/** Only external destinations allowed from the renderer. */
const EXTERNAL_URL_ALLOWLIST = [/^https:\/\/github\.com\/ggml-org\/llama\.cpp(\/|$)/];

const MANAGED_PORT = 8763;

// The system prompt is now built by ChatSession from the tool inventory,
// then frozen into the conversation (J2).

const execFileAsync = promisify(execFile);

function realSpawn(binPath: string, args: string[]): ProcessHandle {
  const child = spawn(binPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
    // POSIX: the server becomes the leader of its own process group, so we
    // can bring down the whole tree at once (see kill).
    ...(process.platform === 'win32' ? {} : { detached: true }),
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    console.log(`[llama-server] ${chunk.toString('utf8').trimEnd()}`);
  });
  void rememberSpawnedPid(child.pid);
  return {
    onExit: (cb) =>
      child.on('exit', (code) => {
        void forgetSpawnedPid();
        cb(code);
      }),
    kill: () => {
      // Windows: the unified `llama serve` CLI is a launcher that spawns the
      // real server as a child — child.kill() would only kill the launcher
      // and leave the model loaded in VRAM. taskkill /T brings down the whole
      // tree.
      //
      // Deliberately SYNCHRONOUS: on shutdown, an asynchronous taskkill
      // doesn't have time to start before Electron quits, and the server
      // survives the app (observed in practice: an orphaned 24 GB
      // llama-server). Blocking for ~50 ms at shutdown is the price of
      // certainty.
      if (process.platform === 'win32' && child.pid) {
        try {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            timeout: 5_000,
          });
        } catch {
          child.kill(); // last resort
        }
      } else {
        // POSIX: kill the process group, not just the launcher.
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM');
          else child.kill();
        } catch {
          child.kill();
        }
      }
    },
  };
}

function stripThink(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
}

function modelDisplayName(modelPath: string): string {
  return basename(modelPath).replace(/\.gguf$/i, '');
}

/** Build tag of the binary (e.g. b10217-ddd4ec142) — 'unknown' as a last resort. */
async function readBuildTag(binPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(binPath, ['--version'], {
      timeout: 5_000,
      windowsHide: true,
    });
    const line = `${stdout}\n${stderr}`
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return line ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Trace of the currently running managed server, to clean it up on the next
 * startup if the app died without a clean shutdown (crash, kill -9, hot
 * reload in development). Otherwise a model of several GB stays in memory
 * with nothing left attaching it to anything.
 */
const PID_FILE = join(bonaparteDataDir(), 'managed-server.pid');

async function rememberSpawnedPid(pid: number | undefined): Promise<void> {
  if (!pid) return;
  try {
    await mkdir(dirname(PID_FILE), { recursive: true });
    await writeFile(PID_FILE, String(pid), 'utf8');
  } catch {
    /* the trace is a convenience, never a prerequisite */
  }
}

async function forgetSpawnedPid(): Promise<void> {
  try {
    await rm(PID_FILE, { force: true });
  } catch {
    /* same */
  }
}

/** Does the process still exist AND is it actually a llama? (guard against PID recycling) */
function isOrphanLlama(pid: number): boolean {
  if (process.platform !== 'win32') {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  const listed = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5_000,
  });
  return /llama/i.test(listed.stdout ?? '');
}

/** Kills a managed server left orphaned after the app ended abruptly. */
async function killOrphanedServer(): Promise<void> {
  let recorded: string;
  try {
    recorded = await readFile(PID_FILE, 'utf8');
  } catch {
    return;
  }
  const pid = Number.parseInt(recorded.trim(), 10);
  await forgetSpawnedPid();
  if (!Number.isInteger(pid) || pid <= 0 || !isOrphanLlama(pid)) return;

  console.log(`[llama-server] orphan detected (pid ${pid}) — stopping`);
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 5_000,
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
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
  private engine: BackendConfigDto | null = null;
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
  private backend: Backend | null = null;
  private live: LiveBackendConfig | null = null;
  /** Model currently loaded by the managed server. */
  private loadedModelPath: string | null = null;
  private session: ChatSession | null = null;
  private unsubscribeStatus: (() => void) | null = null;

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
    await killOrphanedServer();
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
      ...(defaults?.nCtx !== undefined ? { nCtx: defaults.nCtx } : {}),
    });
    return id;
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.store.setTitle(id, title);
  }

  // ── Plugins ────────────────────────────────────────────────────────────

  /**
   * Plugins folder. In development it lives at the root of the repo; once
   * the app is packaged, inside the resources.
   */
  private pluginsDir(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'plugins')
      : join(app.getAppPath(), '..', '..', 'plugins');
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
    this.session = null;
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
    return this.backend?.status() ?? 'stopped';
  }

  /**
   * Configures the engine. Remote: immediate connection. Managed: the server
   * will start on the first openConversation (it needs a model).
   */
  /**
   * Registers the engine WITHOUT connecting to it: on startup, bonaparte must
   * neither ping an endpoint (some servers load the model on the slightest
   * request) nor launch a llama-server. Use `connect()` to activate it.
   */
  async registerEngine(config: BackendConfigDto): Promise<void> {
    await this.teardownBackend();
    this.engine = config;
  }

  async startEngine(config: BackendConfigDto): Promise<BackendStatusDto> {
    await this.teardownBackend();
    this.engine = config;

    if (config.mode === 'remote') {
      const backend = createLlamaCppBackend({ mode: 'remote', url: config.url });
      this.watchStatus(backend);
      await backend.start();
      const props = await backend.props();
      this.backend = backend;
      this.loadedModelPath = props.modelPath || 'remote';
      this.live = {
        modelFingerprint: `remote:${props.modelPath}`,
        nCtx: 0,
        cacheTypeK: 'f16',
        cacheTypeV: 'f16',
        buildTag: 'unknown',
      };
    }

    return this.status();
  }

  private watchStatus(backend: Backend): void {
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = backend.onStatusChange((status) =>
      this.emit(IPC.evBackendStatus, status),
    );
  }

  private async teardownBackend(): Promise<void> {
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
    if (this.backend) {
      await this.backend.stop().catch(() => undefined);
    }
    this.backend = null;
    this.live = null;
    this.loadedModelPath = null;
    this.loadedNCtx = null;
    this.session = null;
  }

  /** Model + nCtx currently served by the managed server. */
  private loadedNCtx: number | null = null;

  /** Guarantees a managed server loaded with THIS model and THIS nCtx. */
  private async ensureManagedBackend(modelPath: string, nCtx: number): Promise<void> {
    if (!this.engine || this.engine.mode !== 'managed') {
      throw new Error('Managed engine not configured.');
    }
    if (
      this.backend &&
      this.loadedModelPath === modelPath &&
      this.loadedNCtx === nCtx &&
      this.backend.status() === 'ready'
    ) {
      return;
    }

    // Model switch: we save the current session's state beforehand.
    await this.saveKv();
    if (this.backend) {
      this.unsubscribeStatus?.();
      await this.backend.stop().catch(() => undefined);
      this.backend = null;
    }

    const cacheType = 'f16';
    const backend = createLlamaCppBackend({
      mode: 'managed',
      binPath: this.engine.binPath,
      spawnFn: realSpawn,
      // Unified `llama` CLI → serve subcommand; legacy binary → nothing.
      commandPrefix: detectServeCommandPrefix(this.engine.binPath),
      launch: {
        modelPath,
        port: MANAGED_PORT,
        nCtx,
        cacheTypeK: cacheType,
        cacheTypeV: cacheType,
        slotSavePath: kvSlotsDir(),
        parallelSlots: 1,
        ...(this.engine.nGpuLayers !== undefined
          ? { nGpuLayers: this.engine.nGpuLayers }
          : {}),
      },
    });
    this.watchStatus(backend);

    await mkdir(kvSlotsDir(), { recursive: true });
    await backend.start();

    this.backend = backend;
    this.loadedModelPath = modelPath;
    this.loadedNCtx = nCtx;
    this.live = {
      modelFingerprint: await fingerprintModelFile(modelPath),
      nCtx,
      cacheTypeK: cacheType,
      cacheTypeV: cacheType,
      buildTag: await readBuildTag(this.engine.binPath),
    };
  }

  async openConversation(
    id?: string,
    modelPath?: string,
    nCtx?: number,
  ): Promise<ConversationOpenReplyDto> {
    if (!this.engine) throw new Error('Engine not configured.');
    id ??= await this.ensureConversationId();

    // Switch: the state of the conversation we're leaving must be saved
    // BEFORE opening another one, otherwise its cache is lost and resuming
    // will cost a full re-prefill — exactly what we claim to avoid.
    if (this.session && this.currentConversationId && this.currentConversationId !== id) {
      await this.session.save().catch(() => false);
      this.session = null;
    }
    if (await this.store.exists(id)) await this.setCurrentConversation(id);

    // Resolves model + nCtx: pinned meta > parameters > Settings default.
    const defaults = (await this.loadConfig()).defaultModel;
    let convModel: string | undefined;
    let convNCtx: number | undefined;
    if (await this.store.exists(id)) {
      const meta = await this.store.meta(id);
      convModel = meta.modelPath ?? modelPath ?? defaults?.path;
      convNCtx = meta.nCtx ?? nCtx ?? defaults?.nCtx;
      if (!meta.modelPath && convModel) {
        await this.store.setModel(id, convModel, convNCtx);
      }
    } else {
      convModel = modelPath ?? defaults?.path;
      convNCtx = nCtx ?? defaults?.nCtx;
    }

    if (this.engine.mode === 'managed') {
      if (!convModel) return { needsModel: true, conversationId: id };
      await this.ensureManagedBackend(convModel, convNCtx ?? 8192);
    } else if (!convModel) {
      // Remote: the model is whatever the server has — informational only.
      convModel = this.loadedModelPath ?? 'remote';
    }

    if (!this.backend || !this.live) throw new Error('Backend not started.');

    if (!(await this.store.exists(id))) {
      await this.store.create(id, {
        modelPath: convModel,
        ...(convNCtx !== undefined ? { nCtx: convNCtx } : {}),
      });
    }

    const { session, restore } = await ChatSession.open(
      {
        backend: this.backend,
        kv: this.kv,
        store: this.store,
        registry: this.registry,
        permissions: this.permissions,
        ...(this.roots.length > 0 ? { roots: this.roots } : {}),
        approve: this.approve,
        // The thread is in English; only the reply language follows the user.
        replyLanguage: (await this.loadConfig()).locale === 'en' ? 'English' : 'French',
        sampling: await this.currentSampling(),
        live: this.live,
      },
      id,
    );
    this.session = session;

    const events = await this.store.loadEvents(id);
    return {
      conversationId: id,
      modelPath: convModel,
      modelName: modelDisplayName(convModel),
      ...(convNCtx !== undefined ? { nCtx: convNCtx } : {}),
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
        ? { modelPath: meta.modelPath, modelName: modelDisplayName(meta.modelPath) }
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
    if (!this.session && this.engine) {
      const reply = await this.openConversation();
      if ('needsModel' in reply) {
        this.emit(IPC.evAgent, {
          type: 'error',
          message: 'No model chosen for this conversation.',
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
    await this.backend?.stop().catch(() => undefined);
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

  async pickFile(kind: PickFileKind): Promise<string | null> {
    if (!this.window) return null;
    const filters =
      kind === 'gguf'
        ? [
            { name: 'Modèle GGUF', extensions: ['gguf'] },
            { name: 'Tous les fichiers', extensions: ['*'] },
          ]
        : process.platform === 'win32'
          ? [
              { name: 'Exécutable', extensions: ['exe'] },
              { name: 'Tous les fichiers', extensions: ['*'] },
            ]
          : [{ name: 'Tous les fichiers', extensions: ['*'] }];
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
      (_e, id?: string, modelPath?: string, nCtx?: number) =>
        this.openConversation(id, modelPath, nCtx),
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
