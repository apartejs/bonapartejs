import {
  IPC,
  type AgentEventDto,
  type AppConfigDto,
  type ApprovalRequestDto,
  type BackendConfigDto,
  type BackendStatusDto,
  type BonaparteBridge,
} from '@aparte/bonaparte-shared';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * Surface exposée au renderer. Jamais d'`ipcRenderer` brut : uniquement des
 * fonctions typées — condition pour que les futurs plugins tiers du renderer
 * ne puissent pas contourner le moteur de permissions.
 */
const api: BonaparteBridge = {
  suggestSetup: () => ipcRenderer.invoke(IPC.setupSuggest),
  pickFile: (kind) => ipcRenderer.invoke(IPC.dialogPickFile, kind),
  scanModels: () => ipcRenderer.invoke(IPC.modelsScan),
  probeEndpoint: (url) => ipcRenderer.invoke(IPC.endpointProbe, url),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  getConfig: (): Promise<AppConfigDto> => ipcRenderer.invoke(IPC.configGet),
  setConfig: (config: AppConfigDto): Promise<void> =>
    ipcRenderer.invoke(IPC.configSet, config),
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
  listPlugins: () => ipcRenderer.invoke(IPC.pluginsList),
  invokePlugin: (pluginId: string, command: string, payload?: unknown) =>
    ipcRenderer.invoke(IPC.pluginsInvoke, pluginId, command, payload),
  getSettings: (scope) => ipcRenderer.invoke(IPC.settingsGet, scope),
  setSetting: (scope, key, value) => ipcRenderer.invoke(IPC.settingsSet, scope, key, value),
  openConversation: (id?: string, modelPath?: string, nCtx?: number) =>
    ipcRenderer.invoke(IPC.conversationOpen, id, modelPath, nCtx),
  sendMessage: (text: string): Promise<void> =>
    ipcRenderer.invoke(IPC.agentSend, text),
  saveKv: (): Promise<boolean> => ipcRenderer.invoke(IPC.kvSave),

  onAgentEvent: (listener: (event: AgentEventDto) => void): (() => void) => {
    const wrapped = (_e: unknown, payload: AgentEventDto): void =>
      listener(payload);
    ipcRenderer.on(IPC.evAgent, wrapped);
    return () => ipcRenderer.removeListener(IPC.evAgent, wrapped);
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
