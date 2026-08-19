import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/node.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node20',
  // Le SDK et React viennent de l'hôte : jamais deux copies.
  external: ['@aparte/bonaparte-plugin-sdk', 'react'],
});
