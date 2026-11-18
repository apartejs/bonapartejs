import { defineConfig } from 'tsup';

export default defineConfig({
  // `plugin-child`: what a plugin's process loads — the child's side of its messages, and nothing else of the core.
  entry: { index: 'src/index.ts', testing: 'src/testing/index.ts', 'plugin-child': 'src/plugins/remote.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node24',
});
