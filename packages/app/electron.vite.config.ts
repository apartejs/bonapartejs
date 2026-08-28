import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
