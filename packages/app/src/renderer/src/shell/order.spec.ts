/**
 * The order of the conversations' list: the one the person wrote in last first, or made last — never moved by a
 * reply that ends, or that the page writes back late, nor by opening one.
 */

import { describe, expect, it } from 'vitest';
import { activityAt, inActivityOrder } from './order';

const user = (timestamp: number) => ({ role: 'user', timestamp });
const reply = (timestamp: number) => ({ role: 'assistant', timestamp });

describe('the order of the conversations', () => {
  it('is when the person last wrote in one, or made it: a reply moves nothing', () => {
    expect(activityAt({ id: 'a', createdAt: 10, updatedAt: 99, messages: [user(20), reply(21)] })).toBe(20);
    expect(activityAt({ id: 'a', createdAt: 10, updatedAt: 99, messages: [] })).toBe(10);
    // A card read from the core, its messages not loaded: the time the core kept, the same key.
    expect(activityAt({ id: 'a', createdAt: 10, updatedAt: 99, personAt: 30, messages: [] })).toBe(30);
    // A summary the page sends as the first message is not the person's.
    expect(activityAt({ id: 'a', createdAt: 10, updatedAt: 99, messages: [{ role: 'user', timestamp: 50, compaction: true }] })).toBe(10);
  });

  it('puts the one the person wrote in last first, though the other’s reply was written back after (the flake of shortcuts.spec.ts:19)', () => {
    const first = { id: 'first', title: 'Première', createdAt: 1, updatedAt: 300, messages: [user(1), reply(2)] };
    const second = { id: 'second', title: 'Seconde', createdAt: 100, updatedAt: 200, messages: [user(100)] };
    expect(inActivityOrder([first, second], new Map()).map((row) => row.id)).toEqual(['second', 'first']);
  });

  it('never moves a row down when its messages go (a going back): the time it reached stays', () => {
    const kept = new Map<string, number>();
    const a = { id: 'a', createdAt: 1, updatedAt: 1, messages: [user(1), user(50)] };
    const b = { id: 'b', createdAt: 20, updatedAt: 20, messages: [user(20)] };
    expect(inActivityOrder([a, b], kept).map((row) => row.id)).toEqual(['a', 'b']);
    expect(inActivityOrder([{ ...a, messages: [user(1)] }, b], kept).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('gives the list the same time it orders by, so that its date groups follow the order', () => {
    const [row] = inActivityOrder([{ id: 'a', createdAt: 1, updatedAt: 999, messages: [user(5)] }], new Map());
    expect(row!.updatedAt).toBe(5);
  });
});
