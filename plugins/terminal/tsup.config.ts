import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/node.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node20',
  // The SDK and React come from the host: never two copies.
  external: ['@aparte/bonaparte-plugin-sdk', 'react'],
});
