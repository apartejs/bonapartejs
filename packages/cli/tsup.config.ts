import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  target: 'node22',
  // The shebang, and a `require` for the CommonJS packages bundled with the core (undici asks Node's own modules
  // with it): an ES module has none of its own (src/built.spec.ts).
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __bonaparteRequire } from 'node:module';",
      'const require = __bonaparteRequire(import.meta.url);',
    ].join('\n'),
  },
  // The workspace is not published: core and shared travel inside the command (task 13.3).
  noExternal: [/^@aparte\/bonaparte-/],
});
