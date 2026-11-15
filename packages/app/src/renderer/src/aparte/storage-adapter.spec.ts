/**
 * aparté's storage adapter of the window: each gesture of the page goes to
 * the core through the bridge — the page keeps nothing of its own.
 */

import type { Bridge } from '@aparte/bonaparte-shared';
import { describe, expect, it } from 'vitest';
import { createStorageAdapter } from './storage-adapter';

/** A core on the other side of the bridge, in memory. */
function core() {
  const kept = new Map<string, unknown>();
  const calls: string[] = [];
  const bridge: Bridge = {
    invoke: (async (channel: { name: string }, input: unknown) => {
      calls.push(channel.name);
      const args = input as { id?: string; document?: { id: string } };
      switch (channel.name) {
        case 'conversations.loadAll':
          return [...kept.values()];
        case 'conversations.loadFull':
          return kept.get(args.id!) ?? null;
        case 'conversations.save':
          kept.set(args.document!.id, structuredClone(args.document));
          return undefined;
        case 'conversations.delete':
          kept.delete(args.id!);
          return undefined;
        default:
          throw new Error(`unexpected ${channel.name}`);
      }
    }) as Bridge['invoke'],
  };
  return { bridge, calls };
}

const CONVERSATION = { id: 'c-1', title: '', createdAt: 1, updatedAt: 2, messages: [{ id: 'm1', role: 'user', content: 'Bonjour' }] };

describe('createStorageAdapter', () => {
  it('gives back what the page saved, as it was saved', async () => {
    const { bridge, calls } = core();
    const adapter = createStorageAdapter(bridge);
    await adapter.save(CONVERSATION as never);
    expect(await adapter.loadAll()).toEqual([CONVERSATION]);
    expect(await adapter.loadFull!('c-1')).toEqual(CONVERSATION);
    expect(calls).toEqual(['conversations.save', 'conversations.loadAll', 'conversations.loadFull']);
  });

  it('deletes through the core', async () => {
    const { bridge } = core();
    const adapter = createStorageAdapter(bridge);
    await adapter.save(CONVERSATION as never);
    await adapter.delete('c-1');
    expect(await adapter.loadAll()).toEqual([]);
  });
});
