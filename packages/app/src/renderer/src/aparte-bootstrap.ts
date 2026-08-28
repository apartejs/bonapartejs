import { registerDefaultRenderers } from '@aparte/core';
import { setupMarkedProvider } from '@aparte/plugin-marked';
import {
  setupShikiProviderFromHighlighter,
  type ShikiHighlighterLike,
} from '@aparte/plugin-shiki/core';
import { setupStreamingMarkdownProvider } from '@aparte/plugin-streaming-markdown';
import githubDark from '@shikijs/themes/github-dark';
import githubLight from '@shikijs/themes/github-light';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/**
 * What the lib expects from the renderer before the first render.
 *
 * Two Markdown providers, and this isn't redundancy:
 * — `setupStreamingMarkdownProvider` parses ONLY the new text and appends DOM
 *   nodes on every chunk. On a local model that streams for minutes,
 *   re-parsing the entire message on every token would be a disaster — this
 *   is the provider that matters most to us.
 * — `setupMarkedProvider` renders FINISHED and re-rendered messages
 *   (reopening a conversation, a replayed message). Without it, the history
 *   would display as raw Markdown while live streaming would be clean.
 *
 * Without either of the two, `aparteGlobalConfig.renderMarkdown` returns the
 * string UNCHANGED: the model displays its asterisks as plain text.
 */
export function bootstrapAparte(): void {
  registerDefaultRenderers();
  setupMarkedProvider({ gfm: true, breaks: true });
  setupStreamingMarkdownProvider();
}

/** shiki theme matching the app's theme. */
function shikiTheme(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? 'github-dark' : 'github-light';
}

/**
 * Built only once: the grammars are frozen, only the theme varies afterward.
 * The JS regex engine avoids oniguruma's WASM (~620 KB), and the grammars
 * themselves (~2 MB) are imported dynamically to stay out of the chunk
 * loaded at startup.
 */
let highlighter: Promise<ShikiHighlighterLike> | null = null;

function ensureHighlighter(): Promise<ShikiHighlighterLike> {
  highlighter ??= import('./shiki-languages.js').then(({ LANGUAGES }) =>
    createHighlighterCore({
      themes: [githubDark, githubLight],
      langs: LANGUAGES,
      engine: createJavaScriptRegexEngine(),
    }),
  );
  return highlighter;
}

/**
 * Syntax highlighting — separated because it is ASYNCHRONOUS.
 *
 * We do NOT block the first render on this: on a local agent, the first code
 * block arrives seconds after startup anyway, and a failure must yield
 * non-highlighted code, never a blank screen.
 *
 * Callable again: changing theme re-registers the provider without
 * rebuilding the highlighter (both themes are already in it).
 */
export async function bootstrapHighlighting(
  theme: 'dark' | 'light',
): Promise<void> {
  setupShikiProviderFromHighlighter(await ensureHighlighter(), {
    theme: shikiTheme(theme),
  });
}
