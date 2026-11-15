/**
 * Ported from v0 (task 6.1): the host's back-pressure, per plugin and per view.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../tools/registry.js';
import type { PluginNodeModule } from '@aparte/bonaparte-shared';
import { FLOW_CONTROL, PluginHost } from './host.js';

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  );
  dirs = [];
});

/** Host with a "term" plugin discovered: `activate` requires it. */
async function hostWithTerm(
  emit = vi.fn(),
): Promise<{ host: PluginHost; emit: ReturnType<typeof vi.fn> }> {
  const root = await mkdtemp(join(tmpdir(), 'bp-flow-'));
  dirs.push(root);
  const dir = join(root, 'term');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'plugin.json'),
    JSON.stringify({ id: 'term', name: 'Terminal', version: '0.1.0' }),
    'utf8',
  );
  const host = new PluginHost({
    registry: new ToolRegistry(),
    emit,
    log: () => undefined,
  });
  await host.discover(root);
  return { host, emit };
}

/**
 * Backpressure for events pushed by a plugin.
 *
 * The terminal was losing output: the producer (a PTY) was outputting
 * faster than the view was reading, and the buffer was trimming the
 * oldest data. VS Code has solved this problem for a long time, and not
 * by growing the buffer: it PAUSES THE PRODUCER. The client acknowledges
 * in batches, and beyond a threshold of unacknowledged bytes the producer
 * must stop until the client catches up.
 *
 * These tests pin down this contract on the host side: `emit` says when
 * to stop, and `onDrain` says when to resume.
 */

/** Minimal plugin that exposes its context for the test to use. */
function capturing(): {
  module: PluginNodeModule;
  ctx: () => {
    emit: (e: string, p: unknown) => boolean;
    onDrain: (cb: () => void) => void;
    channel: (id: string) => {
      emit: (e: string, p: unknown) => boolean;
      onDrain: (cb: () => void) => void;
      reset: () => void;
      dispose: () => void;
    };
  };
} {
  let captured: unknown;
  return {
    module: {
      activate: (context) => {
        captured = context;
      },
    },
    ctx: () => captured as never,
  };
}

describe('backpressure of plugin events', () => {
  it('exposes the thresholds, and the ack threshold does not exceed the low watermark', () => {
    // If the acknowledgment batch were bigger than the low watermark, the
    // producer would never restart: the client would never reach the
    // threshold that triggers the resume. This is the constraint VS Code documents.
    expect(FLOW_CONTROL.ackSize).toBeLessThanOrEqual(FLOW_CONTROL.lowWatermark);
    expect(FLOW_CONTROL.lowWatermark).toBeLessThan(FLOW_CONTROL.highWatermark);
  });

  it('forwards the event to the host, on the default channel', async () => {
    // A single-view plugin has no instance to name: `emit` goes through
    // the default channel, whose id is the empty string.
    const { host: h, emit } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    plugin.ctx().emit('data', 'hello');

    expect(emit).toHaveBeenCalledWith('term', '', 'data', 'hello');
  });

  it('returns true as long as the view keeps up', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    expect(plugin.ctx().emit('data', 'x')).toBe(true);
  });

  it('returns false beyond the high watermark: the producer must stop', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    const chunk = 'x'.repeat(1000);
    let last = true;
    let pushed = 0;
    while (last && pushed < FLOW_CONTROL.highWatermark * 2) {
      last = plugin.ctx().emit('data', chunk);
      pushed += chunk.length;
    }

    expect(last).toBe(false);
    // We stop RIGHT AT the threshold crossing, not well after.
    expect(pushed).toBeLessThanOrEqual(FLOW_CONTROL.highWatermark + chunk.length);
  });

  it('resumes, and signals it, when the view drops back below the low watermark', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    const drained = vi.fn();
    plugin.ctx().onDrain(drained);

    const chunk = 'x'.repeat(FLOW_CONTROL.highWatermark);
    expect(plugin.ctx().emit('data', chunk)).toBe(false);

    // A partial acknowledgment isn't enough: we stay above the low watermark.
    h.acknowledge('term', '', chunk.length - FLOW_CONTROL.lowWatermark - 1);
    expect(drained).not.toHaveBeenCalled();

    // The one that crosses below the low watermark triggers the resume.
    h.acknowledge('term', '', 2);
    expect(drained).toHaveBeenCalledTimes(1);
    expect(plugin.ctx().emit('data', 'x')).toBe(true);
  });

  it('ignores an acknowledgment from an unknown plugin, without throwing', async () => {
    const { host: h } = await hostWithTerm();
    expect(() => h.acknowledge('fantome', '', 100)).not.toThrow();
  });

  it('forgets the counter on teardown: a reactivated plugin starts fresh', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    expect(plugin.ctx().emit('data', 'x'.repeat(FLOW_CONTROL.highWatermark))).toBe(false);
    await h.deactivate('term');

    const again = capturing();
    await h.activate('term', again.module);
    // Without a reset, the reloaded plugin would be born already blocked.
    expect(again.ctx().emit('data', 'x')).toBe(true);
  });

  it('an emit after teardown pushes nothing: the plugin no longer exists', async () => {
    const { host: h, emit } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);
    const orphan = plugin.ctx();
    await h.deactivate('term');

    emit.mockClear();
    expect(orphan.emit('data', 'x')).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('backpressure PER INSTANCE', () => {
  it('routes the event with the targeted instance', async () => {
    const { host: h, emit } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    plugin.ctx().channel('t1').emit('data', 'hello');

    expect(emit).toHaveBeenCalledWith('term', 't1', 'data', 'hello');
  });

  it('counts separately: one tab overflowing does not stop the others', async () => {
    // This is the WHOLE point of the split. With a single counter per
    // plugin, a `cat` of a large file in one terminal would freeze the
    // neighboring terminal.
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    const noisy = plugin.ctx().channel('t1');
    const quiet = plugin.ctx().channel('t2');

    expect(noisy.emit('data', 'x'.repeat(FLOW_CONTROL.highWatermark))).toBe(false);
    expect(quiet.emit('data', 'x')).toBe(true);
  });

  it('acknowledges the targeted instance, and only that one', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    const one = plugin.ctx().channel('t1');
    const two = plugin.ctx().channel('t2');
    expect(one.emit('data', 'x'.repeat(FLOW_CONTROL.highWatermark))).toBe(false);
    expect(two.emit('data', 'y'.repeat(FLOW_CONTROL.highWatermark))).toBe(false);

    h.acknowledge('term', 't1', FLOW_CONTROL.highWatermark);

    expect(one.emit('data', 'x')).toBe(true);
    // t2 acknowledged nothing: it stays paused.
    expect(two.emit('data', 'y')).toBe(false);
  });

  it('a channel reset forgets what was in flight: a new view of the same tab starts free, its listeners kept', async () => {
    // A view that went away never acknowledges what it had not drawn; the one
    // that comes back counts from zero.
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    const tab = plugin.ctx().channel('t1');
    const drained = vi.fn();
    tab.onDrain(drained);
    expect(tab.emit('data', 'x'.repeat(FLOW_CONTROL.highWatermark))).toBe(false);
    tab.reset();
    expect(tab.emit('data', 'x')).toBe(true);
    expect(tab.emit('data', 'x'.repeat(FLOW_CONTROL.highWatermark))).toBe(false);
    h.acknowledge('term', 't1', FLOW_CONTROL.highWatermark);
    expect(drained).toHaveBeenCalledTimes(1);
  });

  it('wakes up the right instance', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    const one = plugin.ctx().channel('t1');
    const two = plugin.ctx().channel('t2');
    const drainedOne = vi.fn();
    const drainedTwo = vi.fn();
    one.onDrain(drainedOne);
    two.onDrain(drainedTwo);

    one.emit('data', 'x'.repeat(FLOW_CONTROL.highWatermark));
    two.emit('data', 'y'.repeat(FLOW_CONTROL.highWatermark));
    h.acknowledge('term', 't1', FLOW_CONTROL.highWatermark);

    expect(drainedOne).toHaveBeenCalledTimes(1);
    expect(drainedTwo).not.toHaveBeenCalled();
  });

  it('a discarded channel forgets its counter: reopening a tab starts free', async () => {
    const { host: h } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    const channel = plugin.ctx().channel('t1');
    expect(channel.emit('data', 'x'.repeat(FLOW_CONTROL.highWatermark))).toBe(false);
    channel.dispose();

    // Same id reused: without a reset, the new tab would be born blocked
    // by the old one's traffic.
    expect(plugin.ctx().channel('t1').emit('data', 'x')).toBe(true);
  });

  it('a discarded channel no longer pushes anything', async () => {
    const { host: h, emit } = await hostWithTerm();
    const plugin = capturing();
    await h.activate('term', plugin.module);

    const channel = plugin.ctx().channel('t1');
    channel.dispose();
    emit.mockClear();

    expect(channel.emit('data', 'x')).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
