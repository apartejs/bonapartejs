import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/node.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node20',
  // React (and electron, where used) come from the host: never two copies.
  // The plugin SDK, on the contrary, is BUNDLED: a built-in plugin ships next
  // to the app inside the CLI package, where no node_modules can resolve it.
  external: ['react'],
  noExternal: ['@aparte/bonaparte-plugin-sdk'],
  // Rollup's tree-shaking drops the SDK's React surface (SettingsForm), which a
  // Node half never uses. External modules are declared side-effect-free, or a
  // bare `import 'react'` would survive and fail outside the monorepo.
  treeshake: { preset: 'recommended', moduleSideEffects: 'no-external' },
});
