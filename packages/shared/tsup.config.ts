import { defineConfig } from 'tsup';

export default defineConfig({
  // `./agent` holds constants only: the main process's bootstrap imports it and nothing else.
  entry: ['src/index.ts', 'src/agent.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node24',
});
