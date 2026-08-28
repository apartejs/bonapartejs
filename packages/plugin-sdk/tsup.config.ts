import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  // React comes from the host: two copies would break the hooks.
  external: ['react', 'react/jsx-runtime'],
});
