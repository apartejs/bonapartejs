import { defineConfig } from 'tsup';

export default defineConfig({
  // `view` and `react` are for a plugin's view, in its frame: never in its Node half.
  entry: ['src/index.ts', 'src/view.ts', 'src/react.ts'],
  external: ['react', 'react-dom'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node24',
});
