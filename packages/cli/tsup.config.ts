import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  // The workspace is not published: core and shared travel inside the command (task 13.3).
  noExternal: [/^@aparte\/bonaparte-/],
});
