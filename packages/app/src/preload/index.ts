import { IPC } from '@aparte/bonaparte-shared';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * Surface exposée au renderer. Jamais d'`ipcRenderer` brut : uniquement des
 * fonctions typées — condition pour que les futurs plugins tiers du renderer
 * ne puissent pas contourner le moteur de permissions.
 */
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
};

export type BonaparteBridge = typeof api;

contextBridge.exposeInMainWorld('bonaparte', api);
