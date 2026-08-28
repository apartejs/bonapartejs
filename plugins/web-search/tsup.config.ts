import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/node.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node20',
  // Electron comes from the host: never two copies. The plugin SDK is
  // BUNDLED: a built-in plugin ships next to the app inside the CLI package,
  // where no node_modules can resolve it.
  external: ['electron'],
  noExternal: ['@aparte/bonaparte-plugin-sdk'],
  treeshake: { preset: 'recommended', moduleSideEffects: 'no-external' },
});
