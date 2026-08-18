import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  // Le tarball npx doit être autonome tant que core/shared ne sont pas
  // publiés : on bundle les paquets workspace dans le CLI.
  noExternal: [/^@aparte\/bonaparte-/],
});
