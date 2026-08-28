/**
 * Footprint budget — the only way to keep an optimization promise.
 *
 * bonaparte is a harness for LOCAL models: it shares the machine with 20 GB
 * of weights and several gigabytes of KV cache. Claiming "we're lightweight"
 * without measuring it is worthless; a budget no test enforces is just a
 * wish. This test fails if the app grows, and the number it prints is the
 * one we're entitled to claim.
 *
 * Measured at rest, window open, no conversation: this is the floor, not the
 * worst case.
 */

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Ceiling at rest, in PRIVATE memory.
 *
 * `workingSetSize` was used here first — that was a mistake, proven: the
 * SAME commit measured 341 MB one evening and 463 MB an hour later. The
 * working set includes shared pages and follows the OS's trimming based on
 * the machine's memory pressure; it varies by ±35% without a single line of
 * code having moved. A test that fails for reasons unrelated to the code is
 * worse than no test: it ends up being ignored.
 *
 * `privateBytes` is the memory the process actually owns. Measured on
 * 2026-08-20: ~200 MB across four processes.
 *
 * Portability caveat: `privateBytes` is populated on Windows; elsewhere it
 * may be 0, in which case we fall back to the working set for lack of
 * anything better.
 */
const BUDGET_MO = 320;

let app: ElectronApplication;

test.beforeAll(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bonaparte-footprint-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || value === undefined) continue;
    env[key] = value;
  }
  env['BONAPARTE_DATA_DIR'] = dataDir;
  env['BONAPARTE_E2E'] = '1';

  app = await electron.launch({
    args: [join(import.meta.dirname, '..', 'out', 'main', 'index.js')],
    env,
  });
  await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
});

test('the app stays within its memory budget', async () => {
  // Measuring right when the window opens gives a flattering number (~275 MB)
  // : rendering hasn't finished settling. This isn't a condition we can poll
  // for, just a stabilization — we wait two seconds, and report the stable
  // number rather than the prettiest one.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics());

  const parProcessus = metrics.map((m) => ({
    type: m.type,
    // privateBytes when the platform provides it; otherwise the working set,
    // for lack of anything better — but then the number is noisy, see the
    // header comment above.
    mo: Math.round((m.memory.privateBytes || m.memory.workingSetSize || 0) / 1024),
  }));
  const total = parProcessus.reduce((sum, p) => sum + p.mo, 0);

  // The number is printed even when the test passes: it's the figure we
  // claim, it shouldn't be visible only on failure.
  console.log(
    `private footprint: ${total} MB — ${parProcessus.map((p) => `${p.type} ${p.mo}`).join(', ')}`,
  );

  expect(total, `private footprint of ${total} MB, budget ${BUDGET_MO} MB`).toBeLessThan(
    BUDGET_MO,
  );
});

test('no VRAM is spent compositing the interface', async () => {
  // `disableHardwareAcceleration()` (main/index.ts): our interface is text
  // and diffs, and every megabyte of VRAM handed to rendering is one less
  // megabyte of context for the model.
  //
  // Measured on 2026-08-20 on Windows (WDDM counters, VISIBLE window — a
  // hidden window isn't composited and reports a zero that proves nothing):
  // same build, acceleration on 31.7 MB of dedicated VRAM, off 0 MB. On the
  // RAM side, the GPU process goes from 120 to 60 MB.
  //
  // This test checks the CAUSE, not the effect: VRAM is measured from the
  // system (see the spec), not from Electron — but the acceleration state
  // itself is readable here. If someone turns the GPU back on without
  // deciding to, this test will catch it.
  const accelerationDisabled = await app.evaluate(({ app: a }) =>
    a.commandLine.hasSwitch('disable-gpu-compositing') ||
    a.getGPUFeatureStatus()['gpu_compositing'] !== 'enabled',
  );

  expect(accelerationDisabled).toBe(true);
});
