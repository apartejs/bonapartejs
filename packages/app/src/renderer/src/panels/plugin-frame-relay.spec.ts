/**
 * The window's side of a plugin's view (task 11.2): what its sandboxed frame asks goes to its plugin through the
 * bridge, and the answer comes back to that frame; the plugin's events and the theme go to the frame. Anything that
 * is not one of these messages is ignored; an error is an answer, never a throw.
 */

import { VIEW_CHANNEL, type ToView } from '@aparte/bonaparte-shared';
import { describe, expect, it, vi } from 'vitest';
import { createFrameRelay } from './plugin-frame-relay';

function rig(invoke: (command: string, payload: unknown) => Promise<unknown>) {
  const posted: ToView[] = [];
  const acks: [string, number][] = [];
  const relay = createFrameRelay({ post: (message) => posted.push(message), invoke, ack: (instanceId, chars) => acks.push([instanceId, chars]) });
  return { relay, posted, acks };
}

describe('the window’s side of a plugin’s view (task 11.2)', () => {
  it('what the frame asks reaches its plugin, and the answer goes back under the same id', async () => {
    const invoke = vi.fn(async (command: string, payload: unknown) => ({ command, payload }));
    const { relay, posted } = rig(invoke);
    relay.fromFrame({ channel: VIEW_CHANNEL, type: 'invoke', id: 7, command: 'count', payload: { of: 'notes' } });
    await vi.waitFor(() => expect(posted).toEqual([{ channel: VIEW_CHANNEL, type: 'reply', id: 7, ok: true, value: { command: 'count', payload: { of: 'notes' } } }]));
    expect(invoke).toHaveBeenCalledWith('count', { of: 'notes' });
  });

  it('a refusal of the plugin is an answer the frame reads', async () => {
    const { relay, posted } = rig(async () => {
      throw new Error('The plugin notes is turned off for this project.');
    });
    relay.fromFrame({ channel: VIEW_CHANNEL, type: 'invoke', id: 1, command: 'count' });
    await vi.waitFor(() => expect(posted).toEqual([{ channel: VIEW_CHANNEL, type: 'reply', id: 1, ok: false, error: 'The plugin notes is turned off for this project.' }]));
  });

  it('an acknowledgement goes to the bridge; a message of another kind is ignored', () => {
    const invoke = vi.fn(async () => null);
    const { relay, posted, acks } = rig(invoke);
    relay.fromFrame({ channel: VIEW_CHANNEL, type: 'ack', instanceId: 'tab-1', chars: 5000 });
    relay.fromFrame({ channel: 'other', type: 'invoke', id: 1, command: 'count' });
    relay.fromFrame({ channel: VIEW_CHANNEL, type: 'invoke', id: 2, command: 'rm -rf /' });
    relay.fromFrame('hello');
    expect(acks).toEqual([['tab-1', 5000]]);
    expect(invoke).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it('the plugin’s events and the theme go to the frame', () => {
    const { relay, posted } = rig(async () => null);
    relay.toFrame.event('tab-1', 'data', 'ls\r\n');
    relay.toFrame.theme('dark');
    expect(posted).toEqual([
      { channel: VIEW_CHANNEL, type: 'event', instanceId: 'tab-1', event: 'data', payload: 'ls\r\n' },
      { channel: VIEW_CHANNEL, type: 'theme', theme: 'dark' },
    ]);
  });
});
