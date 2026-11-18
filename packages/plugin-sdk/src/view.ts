/**
 * The view of a plugin (task 11.2), as its author writes it. It runs in a sandboxed frame of the app's window, on
 * its own origin (`bonaparte-plugin://<id>/`), without the app's bridge: what it needs of its plugin it asks through
 * this channel — the commands its Node half registers —, and it hears its plugin's events and the app's theme. The
 * kit's stylesheet and the app's tokens are served to it at `/@bonaparte/kit.css`: `defineView` links them.
 *
 *     defineView('notes-view', (element, channel) => {
 *       channel.invoke<number>('count').then((count) => (element.textContent = `${count} notes`));
 *     });
 */

import { readToView, VIEW_CHANNEL, type FromView, type ViewTheme } from '@aparte/bonaparte-shared';

export interface ViewChannel {
  /** Ask the plugin: one of the commands its Node half registers. A refusal rejects with its reason. */
  invoke<T = unknown>(command: string, payload?: unknown): Promise<T>;
  /** Hear an event of the plugin; the function returned stops hearing it. */
  on(event: string, listener: (payload: unknown, instanceId: string) => void): () => void;
  /** Say that `chars` more of what the plugin sent are displayed: it sends more when the view keeps up. */
  ack(instanceId: string, chars: number): void;
  /** The app's theme, as the window last said it. */
  readonly theme: ViewTheme | undefined;
  onTheme(listener: (theme: ViewTheme) => void): () => void;
}

/** Where a view's messages go and come from: its parent window, or a test's own. */
export interface ViewHost {
  post(message: FromView): void;
  listen(listener: (data: unknown) => void): () => void;
}

export function connectView(host: ViewHost): ViewChannel {
  let next = 0;
  let theme: ViewTheme | undefined;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const listeners = new Map<string, Set<(payload: unknown, instanceId: string) => void>>();
  const themeListeners = new Set<(theme: ViewTheme) => void>();

  host.listen((data) => {
    const message = readToView(data);
    if (!message) return;
    if (message.type === 'reply') {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (message.ok) waiting?.resolve(message.value);
      else waiting?.reject(new Error(message.error));
      return;
    }
    if (message.type === 'event') {
      for (const listener of listeners.get(message.event) ?? []) listener(message.payload, message.instanceId);
      return;
    }
    theme = message.theme;
    for (const listener of themeListeners) listener(message.theme);
  });
  host.post({ channel: VIEW_CHANNEL, type: 'ready' });

  return {
    invoke: <T>(command: string, payload?: unknown) =>
      new Promise<T>((resolve, reject) => {
        const id = (next += 1);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        host.post({ channel: VIEW_CHANNEL, type: 'invoke', id, command, ...(payload === undefined ? {} : { payload }) });
      }),
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    },
    ack: (instanceId, chars) => host.post({ channel: VIEW_CHANNEL, type: 'ack', instanceId, chars }),
    get theme() {
      return theme;
    },
    onTheme(listener) {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
  };
}

let shared: ViewChannel | undefined;

/** The channel of the view's own frame: its parent window. */
export function viewChannel(): ViewChannel {
  shared ??= connectView({
    // The frame is of no origin, the window of its own: a message is addressed to any, the window checks its source.
    post: (message) => window.parent.postMessage(message, '*'),
    listen: (listener) => {
      const onMessage = (event: MessageEvent): void => {
        if (event.source === window.parent) listener(event.data);
      };
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    },
  });
  return shared;
}

/**
 * A custom element for the view: the kit's stylesheet linked once, the app's theme on the document as the kit reads
 * it (`data-aparte-theme`), and `setup` run with the element and its channel. What `setup` returns is run when the
 * element leaves.
 */
export function defineView(tag: string, setup: (element: HTMLElement, channel: ViewChannel) => void | (() => void)): void {
  if (customElements.get(tag)) return;
  const channel = viewChannel();
  if (!document.querySelector('link[data-bonaparte-kit]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/@bonaparte/kit.css';
    link.dataset['bonaparteKit'] = '';
    document.head.appendChild(link);
  }
  const applyTheme = (theme: ViewTheme): void => document.documentElement.setAttribute('data-aparte-theme', theme);
  if (channel.theme) applyTheme(channel.theme);
  channel.onTheme(applyTheme);
  customElements.define(
    tag,
    class extends HTMLElement {
      private undo: (() => void) | void = undefined;
      connectedCallback(): void {
        this.undo = setup(this, channel);
      }
      disconnectedCallback(): void {
        this.undo?.();
      }
    },
  );
}
