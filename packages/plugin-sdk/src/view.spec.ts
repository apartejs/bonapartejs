/**
 * The view's side (task 11.2): what a plugin author's view uses inside its sandboxed frame — ask its plugin and get
 * the answer, hear its plugin's events, acknowledge what it displayed, follow the app's theme. A message that is not
 * the window's is ignored.
 */

import { VIEW_CHANNEL, type FromView, type ToView } from '@aparte/bonaparte-shared';
import { describe, expect, it } from 'vitest';
import { connectView } from './view.js';

function rig() {
  const sent: FromView[] = [];
  let deliver: (data: unknown) => void = () => undefined;
  const channel = connectView({
    post: (message) => sent.push(message),
    listen: (listener) => {
      deliver = listener;
      return () => undefined;
    },
  });
  return { channel, sent, say: (message: ToView | unknown) => deliver(message) };
}

describe('a plugin’s view, inside its frame (task 11.2)', () => {
  it('says it is ready; asks its plugin and gets the answer of that question', async () => {
    const { channel, sent, say } = rig();
    expect(sent[0]).toEqual({ channel: VIEW_CHANNEL, type: 'ready' });
    const first = channel.invoke('count', { of: 'notes' });
    const second = channel.invoke('list');
    const [, ask1, ask2] = sent as Extract<FromView, { type: 'invoke' }>[];
    expect(ask1).toMatchObject({ type: 'invoke', command: 'count', payload: { of: 'notes' } });
    say({ channel: VIEW_CHANNEL, type: 'reply', id: ask2!.id, ok: true, value: ['a'] });
    say({ channel: VIEW_CHANNEL, type: 'reply', id: ask1!.id, ok: false, error: 'off for this project' });
    await expect(second).resolves.toEqual(['a']);
    await expect(first).rejects.toThrow('off for this project');
  });

  it('hears its plugin’s events, acknowledges what it displayed, and follows the theme', () => {
    const { channel, sent, say } = rig();
    const heard: unknown[] = [];
    const themes: string[] = [];
    const stop = channel.on('data', (payload, instanceId) => heard.push([instanceId, payload]));
    channel.onTheme((theme) => themes.push(theme));
    say({ channel: VIEW_CHANNEL, type: 'event', instanceId: 'tab-1', event: 'data', payload: 'ls' });
    say({ channel: VIEW_CHANNEL, type: 'event', instanceId: 'tab-1', event: 'other', payload: 'x' });
    say({ channel: VIEW_CHANNEL, type: 'theme', theme: 'dark' });
    say({ channel: 'someone-else', type: 'theme', theme: 'light' });
    stop();
    say({ channel: VIEW_CHANNEL, type: 'event', instanceId: 'tab-1', event: 'data', payload: 'after' });
    channel.ack('tab-1', 5000);
    expect(heard).toEqual([['tab-1', 'ls']]);
    expect(themes).toEqual(['dark']);
    expect(channel.theme).toBe('dark');
    expect(sent.at(-1)).toEqual({ channel: VIEW_CHANNEL, type: 'ack', instanceId: 'tab-1', chars: 5000 });
  });
});
