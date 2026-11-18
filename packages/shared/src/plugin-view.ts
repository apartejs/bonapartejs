/**
 * The messages between the view of a plugin of a third party — in its sandboxed frame — and the window that holds
 * it (task 11.2). The frame has no bridge: it asks the window, which asks its plugin through `plugins.invoke` and
 * hands back the answer, the plugin's events and the theme. Every message carries `channel` so that neither side
 * mistakes another page's message for one of these; the window also checks that it comes from its frame.
 */

export const VIEW_CHANNEL = 'bonaparte-view';

export type ViewTheme = 'light' | 'dark';

/** What a view says to the window. */
export type FromView =
  | { channel: typeof VIEW_CHANNEL; type: 'ready' }
  | { channel: typeof VIEW_CHANNEL; type: 'invoke'; id: number; command: string; payload?: unknown }
  | { channel: typeof VIEW_CHANNEL; type: 'ack'; instanceId: string; chars: number };

/** What the window says to a view. */
export type ToView =
  | { channel: typeof VIEW_CHANNEL; type: 'reply'; id: number; ok: true; value: unknown }
  | { channel: typeof VIEW_CHANNEL; type: 'reply'; id: number; ok: false; error: string }
  | { channel: typeof VIEW_CHANNEL; type: 'event'; instanceId: string; event: string; payload: unknown }
  | { channel: typeof VIEW_CHANNEL; type: 'theme'; theme: ViewTheme };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A message of a view, as the window reads one: anything else is ignored. */
export function readFromView(data: unknown): FromView | null {
  if (!isRecord(data) || data['channel'] !== VIEW_CHANNEL) return null;
  if (data['type'] === 'ready') return { channel: VIEW_CHANNEL, type: 'ready' };
  if (data['type'] === 'invoke' && Number.isInteger(data['id']) && typeof data['command'] === 'string' && /^[\w.-]{1,64}$/.test(data['command'])) {
    return { channel: VIEW_CHANNEL, type: 'invoke', id: data['id'] as number, command: data['command'], payload: data['payload'] };
  }
  if (data['type'] === 'ack' && typeof data['instanceId'] === 'string' && Number.isFinite(data['chars']) && (data['chars'] as number) >= 0) {
    return { channel: VIEW_CHANNEL, type: 'ack', instanceId: data['instanceId'], chars: data['chars'] as number };
  }
  return null;
}

/** A message of the window, as a view reads one. */
export function readToView(data: unknown): ToView | null {
  if (!isRecord(data) || data['channel'] !== VIEW_CHANNEL) return null;
  const type = data['type'];
  if (type === 'reply' || type === 'event' || type === 'theme') return data as ToView;
  return null;
}
