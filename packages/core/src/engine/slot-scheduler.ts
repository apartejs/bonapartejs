/**
 * The slots of the engine — one by default — and who has each. A
 * conversation, a sub-agent or work beside them (a compaction, a seed) asks
 * for a slot; requests are served in the order they arrived. When a slot
 * changes hands, the owner leaving is saved if anything changed since it
 * arrived, and the one arriving is restored: the KV state follows its
 * conversation. Work beside a conversation runs on its slot without moving it
 * out — what it adds after the conversation's prefix is dropped by the
 * server at the next turn (cache_prompt keeps the common prefix).
 *
 * A turn lends its slot to its sub-agents (task 8.1): it holds the slot while
 * its tools run, so a sub-agent could never get one of its own. Lending saves
 * the conversation and restores the sub-agent; `home()` brings the
 * conversation back before its next completion — saved once and restored
 * once, however many sub-agents its step ran.
 */

export type SlotOwner =
  | { kind: 'conversation'; conversationId: string; branchId: string }
  | { kind: 'subagent'; conversationId: string; agentId: string; name: string }
  | { kind: 'side'; purpose: 'compaction' | 'seed' };

export interface SlotHandle {
  readonly id: number;
  /** This job left the slot as it found it: the owner need not be saved again for it. */
  unchanged(): void;
  /**
   * What this job's owner leaves in the slot is worth nothing (a sub-agent done, or failed): never saved — not
   * even by the next owner, which takes the slot the moment this job ends (review of phase 8).
   */
  discard(): void;
  /**
   * Lends the slot to another owner (a sub-agent) while this job holds it: the owner in the slot is saved
   * if it changed, the borrower restored, its job run. What the borrower leaves is saved when someone else
   * sits there — unless it says it is worth nothing (`discard`).
   */
  lend<T>(owner: SlotOwner, job: (slot: LentSlot) => Promise<T>): Promise<T>;
  /** Brings this job's owner back into its slot after lending it; nothing when it never left. */
  home(): Promise<void>;
}

export interface LentSlot {
  readonly id: number;
  /** What this borrower leaves in the slot is worth nothing (it finished): it is not saved. */
  discard(): void;
}

export interface SlotScheduler {
  run<T>(owner: SlotOwner, job: (slot: SlotHandle) => Promise<T>, options?: { signal?: AbortSignal }): Promise<T>;
  /** The owners working now. */
  readonly busy: readonly SlotOwner[];
  /** The owners waiting for a slot, in order. */
  readonly waiting: readonly SlotOwner[];
  /** How many slots the engine has, and how many no owner works in now. */
  readonly size: number;
  readonly idle: number;
  /**
   * The engine relaunched with another number of slots (task 8.3): slots are added, or the idle ones last in
   * line taken away. Called once its residents are forgotten (`reset`).
   */
  resize(slots: number): void;
  /** Saves every owner whose state changed (the app closes); `keepFor`: an owner whose saved state must survive the room made. */
  flush(keepFor?: SlotOwner): Promise<void>;
  /** Does this owner sit in a slot — would its next turn find its state there? */
  isResident(owner: SlotOwner): boolean;
  /** Forgets what a slot holds for this owner, without saving it: the engine died, or the conversation was deleted. */
  evict(owner: SlotOwner): void;
  /** Forgets every resident, saving none: the engine was relaunched, and its slots are empty. */
  reset(): void;
  onChange(listener: () => void): () => void;
}

export interface SlotSchedulerOptions {
  slots: number;
  /** `incoming`: the owner about to take the slot — its saved state must survive the room this save makes. */
  save(owner: SlotOwner, slotId: number, incoming?: SlotOwner): Promise<void>;
  restore(owner: SlotOwner, slotId: number): Promise<void>;
  /** A save that failed: the state is lost (a re-read later), the next owner goes on. */
  onError?(error: unknown, owner: SlotOwner): void;
}

interface Slot {
  id: number;
  resident: SlotOwner | null;
  dirty: boolean;
  running: SlotOwner | null;
  /** Who works in the slot now, lent by the owner running there. */
  borrower: SlotOwner | null;
  usedAt: number;
}

interface Waiter {
  owner: SlotOwner;
  start(slot: Slot): void;
}

function keyOf(owner: SlotOwner): string {
  if (owner.kind === 'conversation') return `conversation:${owner.conversationId}:${owner.branchId}`;
  if (owner.kind === 'subagent') return `subagent:${owner.conversationId}:${owner.agentId}`;
  return `side:${owner.purpose}`;
}

export function createSlotScheduler(options: SlotSchedulerOptions): SlotScheduler {
  const fresh = (id: number): Slot => ({ id, resident: null, dirty: false, running: null, borrower: null, usedAt: 0 });
  const slots: Slot[] = Array.from({ length: Math.max(1, options.slots) }, (_, id) => fresh(id));
  const queue: Waiter[] = [];
  const listeners = new Set<() => void>();
  let clock = 0;

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  /** The slot for an owner: the one it already sits in, else an empty one, else the least recently used. */
  function slotFor(owner: SlotOwner): Slot | undefined {
    const free = slots.filter((slot) => slot.running === null);
    if (free.length === 0) return undefined;
    if (owner.kind !== 'side') {
      const home = free.find((slot) => slot.resident && keyOf(slot.resident) === keyOf(owner));
      if (home) return home;
    }
    return free.find((slot) => slot.resident === null) ?? [...free].sort((a, b) => a.usedAt - b.usedAt)[0];
  }

  function dispatch(): void {
    while (queue.length > 0) {
      const slot = slotFor(queue[0]!.owner);
      if (!slot) return;
      const waiter = queue.shift()!;
      slot.running = waiter.owner;
      waiter.start(slot);
    }
  }

  async function save(slot: Slot, incoming?: SlotOwner): Promise<void> {
    const resident = slot.resident;
    if (!resident || !slot.dirty) return;
    try {
      await options.save(resident, slot.id, incoming);
      slot.dirty = false;
    } catch (error) {
      options.onError?.(error, resident);
      slot.resident = null;
      slot.dirty = false;
    }
  }

  async function take(slot: Slot, owner: SlotOwner): Promise<void> {
    if (owner.kind === 'side' || (slot.resident && keyOf(slot.resident) === keyOf(owner))) return;
    await save(slot, owner);
    slot.resident = null;
    await options.restore(owner, slot.id);
    slot.resident = owner;
    slot.dirty = false;
  }

  return {
    run<T>(owner: SlotOwner, job: (slot: SlotHandle) => Promise<T>, runOptions: { signal?: AbortSignal } = {}): Promise<T> {
      const signal = runOptions.signal;
      return new Promise<T>((resolve, reject) => {
        const aborted = (): DOMException => new DOMException('The request for the slot was aborted.', 'AbortError');
        if (signal?.aborted) {
          reject(aborted());
          return;
        }
        const onAbort = (): void => {
          const index = queue.indexOf(waiter);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(aborted());
          emit();
        };
        const waiter: Waiter = {
          owner,
          start(slot) {
            signal?.removeEventListener('abort', onAbort);
            emit();
            void (async () => {
              let changed = true;
              let worthless = false;
              try {
                await take(slot, owner);
                const mine = (): boolean => slot.resident !== null && keyOf(slot.resident) === keyOf(owner);
                const result = await job({
                  id: slot.id,
                  unchanged: () => {
                    changed = false;
                  },
                  discard: () => {
                    worthless = true;
                  },
                  lend: async (borrower, lentJob) => {
                    // The owner, changed by this job: saved before anyone else sits there.
                    if (changed && mine()) slot.dirty = true;
                    await take(slot, borrower);
                    slot.borrower = borrower;
                    emit();
                    let keep = true;
                    try {
                      return await lentJob({
                        id: slot.id,
                        discard: () => {
                          keep = false;
                        },
                      });
                    } finally {
                      slot.borrower = null;
                      if (slot.resident && keyOf(slot.resident) === keyOf(borrower)) {
                        if (keep) slot.dirty = true;
                        else {
                          slot.resident = null;
                          slot.dirty = false;
                        }
                      }
                      emit();
                    }
                  },
                  home: () => take(slot, owner),
                });
                resolve(result);
              } catch (error) {
                reject(error);
              } finally {
                const resident = slot.resident !== null && keyOf(slot.resident) === keyOf(owner);
                if (resident && worthless) {
                  // Before anyone takes the slot: nothing of this owner is left to save.
                  slot.resident = null;
                  slot.dirty = false;
                } else if (owner.kind !== 'side' && changed && resident) {
                  slot.dirty = true;
                }
                slot.running = null;
                slot.usedAt = ++clock;
                emit();
                dispatch();
              }
            })();
          },
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        queue.push(waiter);
        emit();
        dispatch();
      });
    },

    get busy() {
      return slots.flatMap((slot) => (slot.running ? [slot.borrower ?? slot.running] : []));
    },

    get waiting() {
      return queue.map((waiter) => waiter.owner);
    },

    get size() {
      return slots.length;
    },

    get idle() {
      return slots.filter((slot) => slot.running === null).length;
    },

    resize(wanted) {
      const target = Math.max(1, wanted);
      while (slots.length < target) slots.push(fresh(slots.length));
      // Only a slot nobody works in goes; one that works stays until it is done.
      while (slots.length > target && slots.at(-1)!.running === null) slots.pop();
      emit();
      dispatch();
    },

    async flush(keepFor) {
      for (const slot of slots) {
        if (slot.running === null) await save(slot, keepFor);
      }
    },

    isResident(owner) {
      return slots.some((slot) => slot.resident !== null && keyOf(slot.resident) === keyOf(owner));
    },

    evict(owner) {
      for (const slot of slots) {
        if (slot.resident && keyOf(slot.resident) === keyOf(owner)) {
          slot.resident = null;
          slot.dirty = false;
        }
      }
    },

    reset() {
      for (const slot of slots) {
        slot.resident = null;
        slot.dirty = false;
      }
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
