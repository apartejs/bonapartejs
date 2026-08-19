/**
 * Les grammaires embarquées, dans un module À PART et chargé dynamiquement.
 *
 * Elles pèsent ~2 Mo. Statiquement importées depuis l'amorçage, elles
 * entraient dans le morceau principal du renderer, analysé au démarrage —
 * alors qu'aucun bloc de code n'est affiché avant plusieurs secondes. Ici,
 * le bundler en fait un morceau séparé, chargé quand la coloration s'installe.
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
 * Les langages que bonaparte colorise, choisis et non subis.
 *
 * L'entrée de confort de `@aparte/plugin-shiki` importe le bundle complet de
 * shiki, dont la carte des langages est faite d'imports dynamiques : un
 * bundler en émet UN MORCEAU PAR GRAMMAIRE — 302 fichiers, 11 Mo, dont
 * `emacs-lisp` (780 ko), `wasm` et `wolfram` — pour une app qui en affiche
 * vingt. Aucune option d'exécution ne défait ça (la lib l'a vérifié). D'où
 * l'entrée `/core` : on construit le highlighter, donc on choisit ce qu'on
 * embarque.
 *
 * Contrepartie assumée : un langage absent de cette liste s'affiche en texte
 * brut. C'est le bon compromis pour une app distribuée par npx — mais si un
 * langage manque à l'usage, c'est ICI qu'on l'ajoute.
 *
 * (La liste réelle chargée est plus large : une grammaire en embarque
 * d'autres — Markdown et HTML tirent leurs langages imbriqués.)
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
