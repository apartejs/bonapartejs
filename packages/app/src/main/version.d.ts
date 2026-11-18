/// <reference types="electron-vite/node" />

/** bonaparte's version, from its package.json, set at build time (electron.vite.config.ts). */
declare const __BONAPARTE_VERSION__: string;

/** A file's text, put in the build (the kit's stylesheet served to a plugin's view, task 11.2). */
declare module '*?raw' {
  const text: string;
  export default text;
}
