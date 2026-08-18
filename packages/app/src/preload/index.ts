import {
  IPC,
  type AgentEventDto,
  type AppConfigDto,
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
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  getConfig: (): Promise<AppConfigDto> => ipcRenderer.invoke(IPC.configGet),
  setConfig: (config: AppConfigDto): Promise<void> =>
    ipcRenderer.invoke(IPC.configSet, config),
  getBackendStatus: (): Promise<BackendStatusDto> =>
    ipcRenderer.invoke(IPC.backendStatus),
  startBackend: (config: BackendConfigDto): Promise<BackendStatusDto> =>
    ipcRenderer.invoke(IPC.backendStart, config),
  openConversation: (id?: string, modelPath?: string) =>
    ipcRenderer.invoke(IPC.conversationOpen, id, modelPath),
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
};

contextBridge.exposeInMainWorld('bonaparte', api);
