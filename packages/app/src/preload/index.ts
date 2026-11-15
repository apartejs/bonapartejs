/**
 * The preload exposes two functions to the page: `bonaparte.invoke(name,
 * input)`, and `bonaparte.on(listener)` for the one channel the main process
 * pushes on. It is deliberately dumb. Which channels exist, who may call them
 * and with what is decided in the main process, where every call is checked
 * against its channel's schema and its caller's origin.
 */

import { contextBridge, ipcRenderer } from 'electron';

/** The one channel the main process pushes on (a terminal's output): `APP_EVENT` in the contract. */
const APP_EVENT = 'bonaparte:event';

contextBridge.exposeInMainWorld('bonaparte', {
  invoke: (name: string, input: unknown): Promise<unknown> => ipcRenderer.invoke(name, input),
  on: (listener: (event: unknown) => void): (() => void) => {
    const handler = (_event: unknown, payload: unknown): void => listener(payload);
    ipcRenderer.on(APP_EVENT, handler);
    return () => ipcRenderer.removeListener(APP_EVENT, handler);
  },
});
