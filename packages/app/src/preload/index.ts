/**
 * The preload exposes one function to the page: `bonaparte.invoke(name,
 * input)`. It is deliberately dumb. Which channels exist, who may call them
 * and with what is decided in the main process, where every call is checked
 * against its channel's schema and its caller's origin.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('bonaparte', {
  invoke: (name: string, input: unknown): Promise<unknown> => ipcRenderer.invoke(name, input),
});
