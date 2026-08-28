/**
 * Bundled grammars, in a SEPARATE module loaded dynamically.
 *
 * They weigh ~2 MB. Statically imported from the bootstrap, they would land
 * in the renderer's main chunk, parsed at startup — even though no code
 * block is displayed for several seconds. Here, the bundler turns them into
 * a separate chunk, loaded when highlighting installs itself.
 */
import bash from '@shikijs/langs/bash';
import c from '@shikijs/langs/c';
import cpp from '@shikijs/langs/cpp';
import csharp from '@shikijs/langs/csharp';
import css from '@shikijs/langs/css';
import diff from '@shikijs/langs/diff';
import docker from '@shikijs/langs/docker';
import go from '@shikijs/langs/go';
import html from '@shikijs/langs/html';
import ini from '@shikijs/langs/ini';
import java from '@shikijs/langs/java';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import jsx from '@shikijs/langs/jsx';
import markdown from '@shikijs/langs/markdown';
import powershell from '@shikijs/langs/powershell';
import python from '@shikijs/langs/python';
import rust from '@shikijs/langs/rust';
import scss from '@shikijs/langs/scss';
import sql from '@shikijs/langs/sql';
import toml from '@shikijs/langs/toml';
import tsx from '@shikijs/langs/tsx';
import typescript from '@shikijs/langs/typescript';
import xml from '@shikijs/langs/xml';
import yaml from '@shikijs/langs/yaml';

/**
 * The languages bonaparte highlights, chosen rather than endured.
 *
 * `@aparte/plugin-shiki`'s convenience entry point imports shiki's full
 * bundle, whose language map is made of dynamic imports: a bundler emits ONE
 * CHUNK PER GRAMMAR from it — 302 files, 11 MB, including `emacs-lisp`
 * (780 KB), `wasm`, and `wolfram` — for an app that displays twenty of them.
 * No runtime option undoes this (the lib confirmed it). Hence the `/core`
 * entry point: we build the highlighter ourselves, so we choose what we
 * bundle.
 *
 * Accepted trade-off: a language absent from this list displays as plain
 * text. This is the right compromise for an app distributed via npx — but if
 * a language turns out to be missing in practice, this is WHERE it gets
 * added.
 *
 * (The actual list loaded is broader: one grammar bundles others — Markdown
 * and HTML pull in their embedded languages.)
 */
export const LANGUAGES = [
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  docker,
  go,
  html,
  ini,
  java,
  javascript,
  json,
  jsx,
  markdown,
  powershell,
  python,
  rust,
  scss,
  sql,
  toml,
  tsx,
  typescript,
  xml,
  yaml,
];
