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
      // Les vues de plugins vivent hors de packages/app et résolvent React
      // depuis LEUR dossier. Sans dédoublonnage, le bundle pourrait embarquer
      // deux copies — et deux React, ce sont deux jeux de hooks : tout crash au
      // premier useState d'une vue de plugin.
      dedupe: ['react', 'react-dom'],
    },
  },
});
