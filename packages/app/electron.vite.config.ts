import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * The workspace packages are bundled INTO the main and preload bundles
 * rather than required at runtime: the app directory that `npx
 * @aparte/bonaparte` ships must run with nothing but Electron next to it.
 * Third-party dependencies stay external, as usual.
 */
const bundledWorkspace = ['@aparte/bonaparte-core', '@aparte/bonaparte-shared', '@aparte/bonaparte-plugin-sdk'];

/**
 * The packaged renderer's Content-Security-Policy (audit 07, finding 4).
 * Scripts come from the app's own files only — no inline script, no eval —
 * and nothing is fetched from the network: the renderer never talks to a
 * server (the harness does), and a remote image in a reply is not loaded,
 * which also closes the classic exfiltration-by-image-URL. Styles allow
 * inline: React, Radix and the chat components set style attributes.
 *
 * Build only: the dev server's hot reload injects inline scripts.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspace })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspace })],
  },
  renderer: {
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
    resolve: {
      // Plugin views live outside packages/app and resolve React from
      // THEIR OWN folder. Without deduplication, the bundle could end up
      // bundling two copies — and two Reacts means two sets of hooks:
      // everything crashes at a plugin view's first useState.
      dedupe: ['react', 'react-dom'],
    },
  },
});
