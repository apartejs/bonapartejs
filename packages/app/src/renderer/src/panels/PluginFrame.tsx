/**
 * The view of a plugin of a third party (task 11.2): a sandboxed frame on its own origin
 * (`bonaparte-plugin://<id>/`), scripts only — no same origin, no forms, no pop-ups, no navigation of the window.
 * It has no bridge: what it asks of its plugin comes here as a message from that frame alone, and goes through
 * `plugins.invoke` with the project of the conversation shown; its plugin's events and the app's theme go to it.
 */

import { pluginsAck, pluginsInvoke, readFromView, type ViewTheme } from '@aparte/bonaparte-shared';
import { useEffect, useRef } from 'react';
import { bridge } from '../bridge';
import { createFrameRelay } from './plugin-frame-relay';

export interface PluginFrameProps {
  pluginId: string;
  /** The page of its view, relative to its folder. */
  view: string;
  title: string;
  /** The project of the conversation shown: a plugin it turned off answers nothing there. */
  projectId?: string;
}

const themeNow = (): ViewTheme => (document.documentElement.dataset['aparteTheme'] === 'dark' ? 'dark' : 'light');

export function PluginFrame({ pluginId, view, title, projectId }: PluginFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    const relay = createFrameRelay({
      // The frame is of no origin: addressed to any, and only its own frame is ever given it.
      post: (message) => iframe.contentWindow?.postMessage(message, '*'),
      invoke: (command, payload) => bridge.invoke(pluginsInvoke, { pluginId, action: command, payload, ...(projectId ? { projectId } : {}) }),
      ack: (instanceId, chars) => void bridge.invoke(pluginsAck, { pluginId, instanceId, chars }),
    });
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframe.contentWindow) return;
      if (readFromView(event.data)?.type === 'ready') relay.toFrame.theme(themeNow());
      relay.fromFrame(event.data);
    };
    window.addEventListener('message', onMessage);
    const off = bridge.on((event) => {
      if (event.kind === 'plugin' && event.pluginId === pluginId) relay.toFrame.event(event.instanceId, event.event, event.payload);
    });
    const observer = new MutationObserver(() => relay.toFrame.theme(themeNow()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-aparte-theme'] });
    return () => {
      window.removeEventListener('message', onMessage);
      off();
      observer.disconnect();
    };
  }, [pluginId, projectId]);

  const src = `bonaparte-plugin://${pluginId}/${view.split('/').map(encodeURIComponent).join('/')}`;
  return <iframe ref={frame} className="plugin-frame" title={title} sandbox="allow-scripts" src={src} referrerPolicy="no-referrer" />;
}
