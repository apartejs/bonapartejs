/**
 * « Moniteur de ressources » (task 12.4, the built-in entry `resource-monitor`): once the app starts it, the core
 * reads the processor, the memory and the graphics card, and tells each reading; switched off, it reads nothing.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCore, type Core } from '../api.js';
import type { ResourceSample } from './resources.js';

const cores: Core[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const core of cores.splice(0)) await core.stop().catch(() => undefined);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })));
});

describe('the resource monitor', () => {
  it('reads and tells while its entry is on; switched off, it stops', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'bp-resources-'));
    dirs.push(dataDir);
    const samples: ResourceSample[] = [];
    let reads = 0;
    const core = createCore({
      dataDir,
      env: {},
      logger: () => undefined,
      resourceProbes: {
        intervalMs: 20,
        system: async () => {
          reads += 1;
          return { cpu: 12, memory: { usedBytes: 8, totalBytes: 16 } };
        },
        gpu: async () => ({ dedicatedBytes: 1, sharedBytes: null, utilization: 50 }),
      },
      resourcesChanged: (sample) => void samples.push(sample),
    });
    cores.push(core);
    await core.plugins.activateBuiltinEntries();
    // Nothing is read before the app starts it.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(reads).toBe(0);
    core.resources.start();
    await vi.waitFor(() => expect(samples.length).toBeGreaterThan(0));
    expect(samples[0]).toMatchObject({ cpu: 12, memory: { usedBytes: 8, totalBytes: 16 }, gpu: { utilization: 50 } });
    expect(core.resources.last()).toMatchObject({ cpu: 12 });

    await core.plugins.setEnabled('resource-monitor', false);
    const counted = reads;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(reads).toBe(counted);
    expect(core.resources.last()).toBeNull();
  });
});
