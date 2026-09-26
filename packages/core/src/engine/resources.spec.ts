/**
 * ResourceMonitor — what the machine is doing while a model runs: CPU, RAM,
 * GPU memory and load, the server's own footprint. Sampled on a clock,
 * pushed to whoever listens (the status strip), with every probe
 * injectable: the specs run with fakes, the Windows GPU probe is a
 * PowerShell child that only the real machine can prove.
 */

import { describe, expect, it } from 'vitest';
import {
  cpuPercentBetween,
  nodeSystemProbe,
  parseGpuLine,
  ResourceMonitor,
  type ResourceSample,
} from './resources.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ResourceMonitor', () => {
  it('samples on its clock, tags each sample, and stops when told', async () => {
    let calls = 0;
    const monitor = new ResourceMonitor({
      intervalMs: 15,
      system: async () => {
        calls += 1;
        return { cpu: 12, memory: { usedBytes: 4e9, totalBytes: 16e9 } };
      },
      gpu: async () => ({ dedicatedBytes: 2e9, sharedBytes: 1e9, utilization: 7 }),
      serverProcess: async () => ({ pid: 4242, workingSetBytes: 3e9, cpu: 55 }),
    });
    const seen: ResourceSample[] = [];
    monitor.onSample((sample) => seen.push(sample));

    monitor.start();
    // Until three samples, not a fixed 80 ms: under a loaded machine (the
    // E2E suite beside it) the clock's third tick came late, and the test
    // said the monitor was broken.
    const deadline = Date.now() + 2_000;
    while (seen.length < 3 && Date.now() < deadline) await tick(10);
    monitor.stop();
    const countAtStop = seen.length;
    await tick(60);

    expect(countAtStop).toBeGreaterThanOrEqual(3);
    expect(seen.length).toBe(countAtStop);
    expect(calls).toBe(countAtStop);
    const last = seen.at(-1)!;
    expect(last.cpu).toBe(12);
    expect(last.memory).toEqual({ usedBytes: 4e9, totalBytes: 16e9 });
    expect(last.gpu).toEqual({ dedicatedBytes: 2e9, sharedBytes: 1e9, utilization: 7 });
    expect(last.server).toEqual({ pid: 4242, workingSetBytes: 3e9, cpu: 55 });
    expect(last.at).toBeGreaterThan(0);
    expect(monitor.last()).toBe(last);
  });

  it('a probe that fails leaves its figure absent, and the others intact', async () => {
    const monitor = new ResourceMonitor({
      intervalMs: 10,
      system: async () => ({ cpu: 3, memory: { usedBytes: 1, totalBytes: 2 } }),
      gpu: async () => {
        throw new Error('no counters here');
      },
    });
    const seen: ResourceSample[] = [];
    monitor.onSample((sample) => seen.push(sample));

    monitor.start();
    await tick(40);
    monitor.stop();

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.gpu).toBeNull();
    expect(seen[0]?.server).toBeNull();
    expect(seen[0]?.cpu).toBe(3);
  });
});

describe('the probes', () => {
  it('CPU percentage from two readings of the cores’ times', () => {
    // 2 cores; between the readings: core 0 busy 50/100 ms, core 1 busy 100/100 ms.
    const before = [
      { idle: 1000, total: 2000 },
      { idle: 500, total: 2000 },
    ];
    const after = [
      { idle: 1050, total: 2100 },
      { idle: 500, total: 2100 },
    ];
    expect(cpuPercentBetween(before, after)).toBe(75);
    // No time elapsed: nothing to say, not a division by zero.
    expect(cpuPercentBetween(before, before)).toBeNull();
  });

  it('the Node probe reports memory in bytes, within the machine', async () => {
    const first = await nodeSystemProbe();
    expect(first.memory.totalBytes).toBeGreaterThan(0);
    expect(first.memory.usedBytes).toBeGreaterThan(0);
    expect(first.memory.usedBytes).toBeLessThanOrEqual(first.memory.totalBytes);
    // The first reading has nothing to compare with: CPU comes with the second.
    await tick(20);
    const second = await nodeSystemProbe();
    expect(second.cpu === null || (second.cpu >= 0 && second.cpu <= 100)).toBe(true);
  });

  it('parses a line of the Windows GPU probe, tolerating what a machine lacks', () => {
    expect(
      parseGpuLine('{"at":1,"dedicated":2257588224,"shared":977842176,"util":1.81,"ws":3e9,"cpu":12.5}'),
    ).toEqual({
      gpu: { dedicatedBytes: 2257588224, sharedBytes: 977842176, utilization: 1.81 },
      process: { workingSetBytes: 3e9, cpuSeconds: 12.5 },
    });
    // No GPU counters (a VM, a machine without WDDM): no GPU, not a crash.
    expect(parseGpuLine('{"at":1,"dedicated":null,"shared":null,"util":null}')).toEqual({
      gpu: null,
      process: null,
    });
    expect(parseGpuLine('not json')).toBeNull();
  });
});
