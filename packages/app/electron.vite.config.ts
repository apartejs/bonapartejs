import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * The workspace packages are bundled INTO the main bundle rather than required
 * at run time: the app directory that ships must run with nothing but Electron
 * next to it. Third-party dependencies stay external, as usual.
 */
const bundledWorkspace = [
  '@aparte/bonaparte-core',
  '@aparte/bonaparte-shared',
  '@aparte/bonaparte-plugin-sdk',
  '@aparte/bonaparte-plugin-terminal',
  '@aparte/bonaparte-plugin-web-search',
  '@aparte/bonaparte-plugin-browser',
];

/**
 * The Content-Security-Policy of the packaged window. Scripts come from the
 * app's own files only — no inline script, no eval — and the page talks to
 * nothing but its own origin: a turn goes to `bonaparte://app/agent`, never to
 * a server. A remote image in a reply is not loaded, which also closes
 * exfiltration by image URL. Styles allow inline: React and the chat
 * components set style attributes. WebAssembly is allowed for the code
 * highlighter's grammar engine.
 *
 * Build only: the dev server's hot reload injects inline scripts.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'bonaparte-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

/** bonaparte's own version: run from its sources, Electron answers its own to `app.getVersion()`. */
const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  main: {
    define: { __BONAPARTE_VERSION__: JSON.stringify(appVersion) },
    build: {
      externalizeDeps: { exclude: bundledWorkspace },
    },
  },
  preload: {
    build: {
      // A sandboxed preload is one self-contained CommonJS file.
      externalizeDeps: false,
      isolatedEntries: true,
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), contentSecurityPolicy()],
    resolve: {
      // A plugin view resolves React from its own folder: without this the
      // bundle could hold two Reacts, and two sets of hooks.
      dedupe: ['react', 'react-dom'],
    },
  },
});
