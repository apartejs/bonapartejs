import {
  IPC,
  type AgentEventDto,
  type AppConfigDto,
  type ApprovalRequestDto,
  type BackendConfigDto,
  type BackendStatusDto,
  type BonaparteBridge,
  type InFlightDto,
  type ResourceSampleDto,
} from '@aparte/bonaparte-shared';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * Surface exposed to the renderer. Never raw `ipcRenderer`: only typed
 * functions — a condition for future third-party renderer plugins to be
 * unable to bypass the permission engine.
 */
const api: BonaparteBridge = {
  suggestSetup: () => ipcRenderer.invoke(IPC.setupSuggest),
  pickFile: (kind) => ipcRenderer.invoke(IPC.dialogPickFile, kind),
  scanModels: () => ipcRenderer.invoke(IPC.modelsScan),
  estimateSwitch: (conversationId, modelPath) =>
    ipcRenderer.invoke(IPC.modelsEstimateSwitch, conversationId, modelPath),
  probeEndpoint: (url) => ipcRenderer.invoke(IPC.endpointProbe, url),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  getConfig: (): Promise<AppConfigDto> => ipcRenderer.invoke(IPC.configGet),
  setDefaultModel: (modelPath) => ipcRenderer.invoke(IPC.configSetDefaultModel, modelPath),
  setLocale: (locale) => ipcRenderer.invoke(IPC.configSetLocale, locale),
  getBackendStatus: (): Promise<BackendStatusDto> =>
    ipcRenderer.invoke(IPC.backendStatus),
  startBackend: (config: BackendConfigDto): Promise<BackendStatusDto> =>
    ipcRenderer.invoke(IPC.backendStart, config),
  registerBackend: (config) => ipcRenderer.invoke(IPC.backendRegister, config),
  conversationHistory: (select?: string) =>
    ipcRenderer.invoke(IPC.conversationHistory, select),
  listConversations: () => ipcRenderer.invoke(IPC.conversationList),
  createConversation: (projectRoot?: string) =>
    ipcRenderer.invoke(IPC.conversationCreate, projectRoot),
  renameConversation: (id: string, title: string) =>
    ipcRenderer.invoke(IPC.conversationRename, id, title),
  deleteConversation: (id: string) => ipcRenderer.invoke(IPC.conversationDelete, id),
  markConversation: (id, marks) => ipcRenderer.invoke(IPC.conversationMark, id, marks),
  branchConversation: (id, options) => ipcRenderer.invoke(IPC.conversationBranch, id, options),
  compactConversation: (id) => ipcRenderer.invoke(IPC.conversationCompact, id),
  undoTurn: (conversationId, turnId) => ipcRenderer.invoke(IPC.turnUndo, conversationId, turnId),
  listPlugins: () => ipcRenderer.invoke(IPC.pluginsList),
  reloadPlugins: () => ipcRenderer.invoke(IPC.pluginsReload),
  setPluginEnabled: (pluginId, enabled) => ipcRenderer.invoke(IPC.pluginsSetEnabled, pluginId, enabled),
  onPluginEvent: (listener) => {
    const wrapped = (
      _e: unknown,
      payload: {
        pluginId: string;
        instanceId: string;
        event: string;
        payload: unknown;
      },
    ): void => listener(payload);
    ipcRenderer.on(IPC.evPlugin, wrapped);
    return () => ipcRenderer.removeListener(IPC.evPlugin, wrapped);
  },
  ackPluginData: (pluginId, instanceId, bytes) => {
    void ipcRenderer.invoke(IPC.pluginsAck, pluginId, instanceId, bytes);
  },
  invokePlugin: (pluginId: string, command: string, payload?: unknown) =>
    ipcRenderer.invoke(IPC.pluginsInvoke, pluginId, command, payload),
  getSettings: (scope) => ipcRenderer.invoke(IPC.settingsGet, scope),
  setSetting: (scope, key, value) => ipcRenderer.invoke(IPC.settingsSet, scope, key, value),
  openConversation: (id?: string, modelPath?: string) =>
    ipcRenderer.invoke(IPC.conversationOpen, id, modelPath),
  sendMessage: (text, attachments) => ipcRenderer.invoke(IPC.agentSend, text, attachments),
  saveKv: (): Promise<boolean> => ipcRenderer.invoke(IPC.kvSave),
  kvUsage: () => ipcRenderer.invoke(IPC.kvUsage),
  freeKv: () => ipcRenderer.invoke(IPC.kvFree),
  inFlight: (): Promise<InFlightDto | null> => ipcRenderer.invoke(IPC.agentInFlight),
  cancelMessage: (): Promise<void> => ipcRenderer.invoke(IPC.agentCancel),

  onAgentEvent: (listener: (event: AgentEventDto) => void): (() => void) => {
    const wrapped = (_e: unknown, payload: AgentEventDto): void =>
      listener(payload);
    ipcRenderer.on(IPC.evAgent, wrapped);
    return () => ipcRenderer.removeListener(IPC.evAgent, wrapped);
  },
  onResources: (listener: (sample: ResourceSampleDto) => void): (() => void) => {
    const wrapped = (_e: unknown, payload: ResourceSampleDto): void => listener(payload);
    ipcRenderer.on(IPC.evResources, wrapped);
    return () => ipcRenderer.removeListener(IPC.evResources, wrapped);
  },
  onNavigate: (listener: (conversationId: string) => void): (() => void) => {
    const wrapped = (_e: unknown, conversationId: string): void => listener(conversationId);
    ipcRenderer.on(IPC.evNavigate, wrapped);
    return () => ipcRenderer.removeListener(IPC.evNavigate, wrapped);
  },
  onBackendStatus: (
    listener: (status: BackendStatusDto) => void,
  ): (() => void) => {
    const wrapped = (_e: unknown, payload: BackendStatusDto): void =>
      listener(payload);
    ipcRenderer.on(IPC.evBackendStatus, wrapped);
    return () => ipcRenderer.removeListener(IPC.evBackendStatus, wrapped);
  },

  openProject: () => ipcRenderer.invoke(IPC.projectOpen),
  currentProject: () => ipcRenderer.invoke(IPC.projectCurrent),
  listProjects: () => ipcRenderer.invoke(IPC.projectsList),
  createProject: (name, roots) => ipcRenderer.invoke(IPC.projectCreate, name, roots),
  renameProject: (id, name) => ipcRenderer.invoke(IPC.projectRename, id, name),
  setProjectRoots: (id, roots) => ipcRenderer.invoke(IPC.projectSetRoots, id, roots),
  removeProject: (id) => ipcRenderer.invoke(IPC.projectRemove, id),
  pickDirectory: () => ipcRenderer.invoke(IPC.dialogPickDirectory),
  setConversationProject: (conversationId, projectId) =>
    ipcRenderer.invoke(IPC.conversationSetProject, conversationId, projectId),
  listGrants: () => ipcRenderer.invoke(IPC.grantsList),
  revokeGrant: (grant) => ipcRenderer.invoke(IPC.grantsRevoke, grant),
  getMode: () => ipcRenderer.invoke(IPC.modeGet),
  setMode: (mode) => ipcRenderer.invoke(IPC.modeSet, mode),
  respondToApproval: (response) =>
    ipcRenderer.invoke(IPC.approvalRespond, response),
  onApprovalRequest: (listener): (() => void) => {
    const wrapped = (_e: unknown, payload: ApprovalRequestDto): void =>
      listener(payload);
    ipcRenderer.on(IPC.evApproval, wrapped);
    return () => ipcRenderer.removeListener(IPC.evApproval, wrapped);
  },
};

contextBridge.exposeInMainWorld('bonaparte', api);
