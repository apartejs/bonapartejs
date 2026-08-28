import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * The workspace packages are bundled INTO the main and preload bundles
 * rather than required at runtime: the app directory that `npx
 * @aparte/bonaparte` ships must run with nothing but Electron next to it.
 * Third-party dependencies stay external, as usual.
 */
const bundledWorkspace = ['@aparte/bonaparte-core', '@aparte/bonaparte-shared', '@aparte/bonaparte-plugin-sdk'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspace })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspace })],
  },
  renderer: {
    plugins: [react()],
    resolve: {
      // Plugin views live outside packages/app and resolve React from
      // THEIR OWN folder. Without deduplication, the bundle could end up
      // bundling two copies — and two Reacts means two sets of hooks:
      // everything crashes at a plugin view's first useState.
      dedupe: ['react', 'react-dom'],
    },
  },
});
