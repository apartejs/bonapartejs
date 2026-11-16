import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Many of the core's tests launch processes (the fake engine, git, a shell): on Windows a launch of the fake
    // engine takes about a second, and a test that launches three (a relaunch after a crash) takes 8 s alone —
    // more under the parallel load of every package. A hung test still fails, only later.
    testTimeout: 30_000,
  },
});
