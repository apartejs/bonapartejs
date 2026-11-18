/**
 * The process of a plugin of a third party (an Electron utility process, task 11.1): one per plugin. It loads the
 * plugin's Node half from its folder and gives it a context made of messages to the main process — the core's
 * `runPluginChild`. A crash here never takes the app, nor another plugin, down.
 */

import { pathToFileURL } from 'node:url';
import { runPluginChild, type ToPluginProcess } from '@aparte/bonaparte-core/plugin-child';

const port = process.parentPort;

runPluginChild(
  {
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => port.on('message', (event) => listener(event.data as ToPluginProcess)),
  },
  (file) => import(pathToFileURL(file).href),
);
