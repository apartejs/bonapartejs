import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  // The npx tarball must be self-contained as long as core/shared aren't
  // published: we bundle the workspace packages into the CLI.
  noExternal: [/^@aparte\/bonaparte-/],
});
