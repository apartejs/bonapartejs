/**
 * The view of a plugin in React (task 11.2): the plugin brings its own React — its frame shares nothing with the
 * app's window —, and its component gets the view's channel.
 *
 *     defineReactView('notes-view', ({ channel }) => <Notes channel={channel} />);
 */

import { createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { defineView, type ViewChannel } from './view.js';

export type { ViewChannel } from './view.js';

export function defineReactView(tag: string, Component: ComponentType<{ channel: ViewChannel }>): void {
  defineView(tag, (element, channel) => {
    const root = createRoot(element);
    root.render(createElement(Component, { channel }));
    return () => root.unmount();
  });
}
