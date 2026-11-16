/**
 * The slot is the engine's scarce resource: one by default. Conversations,
 * sub-agents and the work beside them (a compaction, a seed) take it in
 * turn. When its owner changes, the one leaving is saved — if it changed —
 * and the one arriving restored. A request stopped while it waits never
 * takes the slot.
 */

import { describe, expect, it } from 'vitest';
import { createSlotScheduler, type SlotOwner } from './slot-scheduler.js';

const A: SlotOwner = { kind: 'conversation', conversationId: 'a', branchId: 'main' };
const B: SlotOwner = { kind: 'conversation', conversationId: 'b', branchId: 'main' };
const SIDE: SlotOwner = { kind: 'side', purpose: 'compaction' };

function name(owner: SlotOwner): string {
  return owner.kind === 'conversation' ? owner.conversationId : owner.kind === 'subagent' ? owner.agentId : owner.purpose;
}

function rig(slots = 1) {
  const calls: string[] = [];
  const scheduler = createSlotScheduler({
    slots,
    save: async (owner, slot) => void calls.push(`save ${name(owner)}@${slot}`),
    restore: async (owner, slot) => void calls.push(`restore ${name(owner)}@${slot}`),
  });
  const work = (label: string) => async () => void calls.push(`run ${label}`);
  return { scheduler, calls, work };
}

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
};

describe('createSlotScheduler', () => {
  it('going from A to B and back saves A, restores B, then saves B and restores A', async () => {
    const { scheduler, calls, work } = rig();
    await scheduler.run(A, work('a'));
    await scheduler.run(B, work('b'));
    await scheduler.run(A, work('a again'));
    expect(calls).toEqual([
      'restore a@0',
      'run a',
      'save a@0',
      'restore b@0',
      'run b',
      'save b@0',
      'restore a@0',
      'run a again',
    ]);
  });

  it('a conversation that stays in the slot is neither saved nor restored between its turns', async () => {
    const { scheduler, calls, work } = rig();
    await scheduler.run(A, work('1'));
    await scheduler.run(A, work('2'));
    expect(calls).toEqual(['restore a@0', 'run 1', 'run 2']);
  });

  it('does not write A again when nothing ran in it', async () => {
    const { scheduler, calls } = rig();
    await scheduler.run(A, async (slot) => {
      calls.push('look at a');
      slot.unchanged();
    });
    await scheduler.run(B, async () => void calls.push('run b'));
    expect(calls).toEqual(['restore a@0', 'look at a', 'restore b@0', 'run b']);
  });

  it('work beside a conversation runs on its slot without moving it out', async () => {
    const { scheduler, calls, work } = rig();
    await scheduler.run(A, work('a'));
    await scheduler.run(SIDE, work('summary'));
    await scheduler.run(A, work('a again'));
    expect(calls).toEqual(['restore a@0', 'run a', 'run summary', 'run a again']);
  });

  it('serves the requests in the order they arrived, one at a time on one slot', async () => {
    const { scheduler } = rig();
    const order: string[] = [];
    const first = gate();
    const running = scheduler.run(A, async () => {
      order.push('a starts');
      await first.opened;
      order.push('a ends');
    });
    const b = scheduler.run(B, async () => void order.push('b'));
    const c = scheduler.run({ kind: 'conversation', conversationId: 'c', branchId: 'main' }, async () => void order.push('c'));
    await Promise.resolve();
    expect(scheduler.busy).toEqual([A]);
    expect(scheduler.waiting).toEqual([B, { kind: 'conversation', conversationId: 'c', branchId: 'main' }]);
    first.open();
    await Promise.all([running, b, c]);
    expect(order).toEqual(['a starts', 'a ends', 'b', 'c']);
  });

  it('a request stopped while it waits never takes the slot', async () => {
    const { scheduler, calls } = rig();
    const first = gate();
    const running = scheduler.run(A, () => first.opened);
    const controller = new AbortController();
    const waiting = scheduler.run(B, async () => void calls.push('run b'), { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toThrow(/abort/i);
    first.open();
    await running;
    await scheduler.run(A, async () => void calls.push('run a'));
    expect(calls).toEqual(['restore a@0', 'run a']);
  });

  it('with two slots, two owners work at the same time, each kept on its own slot', async () => {
    const { scheduler, calls } = rig(2);
    const both = gate();
    let together = 0;
    const job = async () => {
      together += 1;
      await both.opened;
    };
    const a = scheduler.run(A, job);
    const b = scheduler.run(B, job);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(together).toBe(2);
    both.open();
    await Promise.all([a, b]);
    await scheduler.run(B, async () => void calls.push('run b again'));
    expect(calls.filter((call) => call.startsWith('restore'))).toEqual(['restore a@0', 'restore b@1']);
  });

  it('saves what changed when the app closes', async () => {
    const { scheduler, calls, work } = rig();
    await scheduler.run(A, work('a'));
    await scheduler.flush();
    await scheduler.flush();
    expect(calls).toEqual(['restore a@0', 'run a', 'save a@0']);
  });

  it('tells its listeners when the slot changes hands', async () => {
    const { scheduler, work } = rig();
    let changes = 0;
    const stop = scheduler.onChange(() => (changes += 1));
    await scheduler.run(A, work('a'));
    stop();
    await scheduler.run(B, work('b'));
    expect(changes).toBeGreaterThanOrEqual(2);
    const after = changes;
    await scheduler.run(A, work('a'));
    expect(changes).toBe(after);
  });

  it('a save that fails costs the state, not the next owner its turn', async () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    const scheduler = createSlotScheduler({
      slots: 1,
      save: async () => {
        throw new Error('no space left on device');
      },
      restore: async (owner) => void calls.push(`restore ${name(owner)}`),
      onError: (error) => errors.push(error),
    });
    await scheduler.run(A, async () => undefined);
    await scheduler.run(B, async () => void calls.push('run b'));
    expect(calls).toEqual(['restore a', 'restore b', 'run b']);
    expect(String(errors[0])).toMatch(/no space/);
  });

  it('tells the save of the owner leaving which owner arrives: its state must survive the room made', async () => {
    const saves: string[] = [];
    const scheduler = createSlotScheduler({
      slots: 1,
      save: async (owner, _slot, incoming) => void saves.push(`${name(owner)} for ${incoming ? name(incoming) : 'nobody'}`),
      restore: async () => undefined,
    });
    await scheduler.run(A, async () => undefined);
    await scheduler.run(B, async () => undefined);
    await scheduler.flush();
    expect(saves).toEqual(['a for b', 'b for nobody']);
  });

  it('a relaunched engine holds nothing: every resident is forgotten, none is saved', async () => {
    const { scheduler, calls, work } = rig(2);
    await scheduler.run(A, work('a'));
    await scheduler.run(B, work('b'));
    scheduler.reset();
    expect(scheduler.isResident(A)).toBe(false);
    expect(scheduler.isResident(B)).toBe(false);
    await scheduler.flush();
    await scheduler.run(A, work('a again'));
    // Nothing saved over the states on disk: the slots of the new server are empty.
    expect(calls).toEqual(['restore a@0', 'run a', 'restore b@1', 'run b', 'restore a@0', 'run a again']);
  });

  it('says whether an owner sits in a slot, and forgets one without saving it', async () => {
    const { scheduler, calls, work } = rig();
    expect(scheduler.isResident(A)).toBe(false);
    await scheduler.run(A, work('a'));
    expect(scheduler.isResident(A)).toBe(true);
    // The engine died, or the conversation was deleted: what the slot held is not saved.
    scheduler.evict(A);
    expect(scheduler.isResident(A)).toBe(false);
    await scheduler.run(B, work('b'));
    expect(calls).toEqual(['restore a@0', 'run a', 'restore b@0', 'run b']);
  });
});

describe('a turn lends its slot to its sub-agents (task 8.1)', () => {
  const sub = (agentId: string): SlotOwner => ({ kind: 'subagent', conversationId: 'a', agentId, name: agentId });

  it('the conversation is saved, the sub-agent restored; then the conversation comes home, restored', async () => {
    const { scheduler, calls } = rig();
    await scheduler.run(A, async (slot) => {
      calls.push('run a');
      await slot.lend(sub('s1'), async (lent) => {
        calls.push(`run s1@${lent.id}`);
        lent.discard();
      });
      await slot.home();
      calls.push('run a again');
    });
    expect(calls).toEqual(['restore a@0', 'run a', 'save a@0', 'restore s1@0', 'run s1@0', 'restore a@0', 'run a again']);
  });

  it('three sub-agents of one step: the conversation is saved once, and restored once', async () => {
    const { scheduler, calls } = rig();
    await scheduler.run(A, async (slot) => {
      for (const agent of ['s1', 's2', 's3']) {
        await slot.lend(sub(agent), async (lent) => {
          calls.push(`run ${agent}`);
          lent.discard();
        });
      }
      await slot.home();
    });
    expect(calls).toEqual(['restore a@0', 'save a@0', 'restore s1@0', 'run s1', 'restore s2@0', 'run s2', 'restore s3@0', 'run s3', 'restore a@0']);
  });

  it('a sub-agent that stops to ask keeps its state: saved when the conversation comes home, or when another owner takes the slot', async () => {
    const { scheduler, calls } = rig();
    await scheduler.run(A, async (slot) => {
      await slot.lend(sub('s1'), async () => void calls.push('run s1, then ask'));
      await slot.home();
    });
    await scheduler.run(A, async (slot) => {
      await slot.lend(sub('s2'), async () => void calls.push('run s2, then ask'));
    });
    // The turn paused right after its sub-agent did: whoever comes next finds it in the slot, and saves it.
    await scheduler.run(B, async () => void calls.push('run b'));
    expect(calls).toEqual([
      'restore a@0',
      'save a@0',
      'restore s1@0',
      'run s1, then ask',
      'save s1@0',
      'restore a@0',
      'save a@0',
      'restore s2@0',
      'run s2, then ask',
      'save s2@0',
      'restore b@0',
      'run b',
    ]);
  });

  it('while the slot is lent, the sub-agent is the one at work', async () => {
    const { scheduler } = rig();
    const seen: SlotOwner[][] = [];
    await scheduler.run(A, async (slot) => {
      seen.push([...scheduler.busy]);
      await slot.lend(sub('s1'), async (lent) => {
        seen.push([...scheduler.busy]);
        lent.discard();
      });
      seen.push([...scheduler.busy]);
    });
    expect(seen.map((owners) => owners.map(name))).toEqual([['a'], ['s1'], ['a']]);
  });

  it('a conversation that never lent its slot is already home', async () => {
    const { scheduler, calls } = rig();
    await scheduler.run(A, async (slot) => {
      calls.push('run a');
      await slot.home();
    });
    expect(calls).toEqual(['restore a@0', 'run a']);
  });
});


describe('the slots follow the engine (task 8.3)', () => {
  it('says how many slots are free, and takes a new number once the engine relaunched with it', async () => {
    const { scheduler, calls } = rig(1);
    expect(scheduler.size).toBe(1);
    expect(scheduler.idle).toBe(1);
    scheduler.reset();
    scheduler.resize(2);
    expect(scheduler.size).toBe(2);
    expect(scheduler.idle).toBe(2);
    let release!: () => void;
    const held = scheduler.run(A, () => new Promise<void>((resolve) => (release = resolve)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduler.idle).toBe(1);
    // A second owner runs at once beside it, on the other slot.
    await scheduler.run(B, async (slot) => void calls.push(`run b@${slot.id}`));
    release();
    await held;
    expect(calls).toContain('run b@1');
    scheduler.reset();
    scheduler.resize(1);
    expect(scheduler.size).toBe(1);
  });
});
