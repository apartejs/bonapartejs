import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/node.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node20',
  // electron is provided by the host: the bundler must never bundle it.
  external: ['@aparte/bonaparte-plugin-sdk', 'electron', 'react'],
});
