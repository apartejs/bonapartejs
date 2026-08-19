import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  // React vient de l'hôte : deux copies casseraient les hooks.
  external: ['react', 'react/jsx-runtime'],
});
