import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/node.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node20',
  // electron est fourni par l'hôte : le bundler ne doit jamais l'embarquer.
  external: ['@aparte/bonaparte-plugin-sdk', 'electron', 'react'],
});
