/**
 * The window's side of the view of a plugin of a third party (task 11.2): its sandboxed frame has no bridge, so
 * what it asks comes here, goes to its plugin through `plugins.invoke`, and the answer goes back to it; the
 * plugin's events and the theme go to it too. The caller hands only the messages of its own frame.
 */

import { readFromView, VIEW_CHANNEL, type ToView, type ViewTheme } from '@aparte/bonaparte-shared';

export interface FrameRelayOptions {
  post(message: ToView): void;
  invoke(command: string, payload: unknown): Promise<unknown>;
  ack(instanceId: string, chars: number): void;
}

export function createFrameRelay(options: FrameRelayOptions) {
  return {
    /** A message of the frame: one of a view's, or ignored. */
    fromFrame(data: unknown): void {
      const message = readFromView(data);
      if (!message) return;
      if (message.type === 'ack') {
        options.ack(message.instanceId, message.chars);
        return;
      }
      if (message.type !== 'invoke') return;
      const { id } = message;
      void options.invoke(message.command, message.payload).then(
        (value) => options.post({ channel: VIEW_CHANNEL, type: 'reply', id, ok: true, value }),
        (error: unknown) => options.post({ channel: VIEW_CHANNEL, type: 'reply', id, ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    },
    toFrame: {
      event: (instanceId: string, event: string, payload: unknown) => options.post({ channel: VIEW_CHANNEL, type: 'event', instanceId, event, payload }),
      theme: (theme: ViewTheme) => options.post({ channel: VIEW_CHANNEL, type: 'theme', theme }),
    },
  };
}
