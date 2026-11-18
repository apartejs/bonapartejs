/**
 * The built-in browser's channels (task 10.1): the window says where the tab shown goes and what the person
 * typed; the pages are the main process's, never the window's.
 */

import {
  browserBack,
  browserCancelPick,
  browserCloseTab,
  browserConsole,
  browserHide,
  browserNavigate,
  browserOpenTab,
  browserPick,
  browserPins,
  browserPlace,
  browserReload,
  browserTabs,
} from '@aparte/bonaparte-shared';
import type { BuiltinBrowser } from '../browser/service.js';
import type { IpcRegistry } from './register.js';

export function registerBrowserChannels(ipc: IpcRegistry, browser: Pick<BuiltinBrowser, 'views' | 'reading'>): void {
  const { views } = browser;
  ipc.handle(browserTabs, () => ({ tabs: views.states(), reading: browser.reading() }));
  ipc.handle(browserOpenTab, ({ tabId }) => views.openTab(tabId));
  ipc.handle(browserCloseTab, ({ tabId }) => views.closeTab(tabId));
  ipc.handle(browserNavigate, ({ tabId, url }) => views.navigate(tabId, url));
  ipc.handle(browserBack, ({ tabId }) => views.back(tabId));
  ipc.handle(browserReload, ({ tabId }) => views.reload(tabId));
  ipc.handle(browserPlace, ({ tabId, rect, device }) => views.place(tabId, rect, device));
  ipc.handle(browserHide, () => views.hideAll());
  ipc.handle(browserConsole, ({ tabId }) => views.console(tabId));
  ipc.handle(browserPick, ({ tabId, accent }) => views.pick(tabId, accent));
  ipc.handle(browserCancelPick, ({ tabId }) => views.cancelPick(tabId));
  ipc.handle(browserPins, ({ tabId, pins, accent }) => views.pins(tabId, pins, accent));
}
