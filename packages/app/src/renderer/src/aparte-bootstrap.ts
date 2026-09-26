import { aparteGlobalConfig, registerDefaultRenderers, registerSegmentRenderer, type AparteSegmentBase } from '@aparte/core';
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
  registerToolSummaries();
  registerSegmentRenderer(changesRenderer);
}

/**
 * What a turn wrote, at the end of its bubble, with a way back (06 §1 D).
 * The strings come with the segment (the renderer has no locale of its
 * own); the button asks the screen, which asks the harness.
 */
export interface ChangesSegment extends AparteSegmentBase {
  type: 'bp-changes';
  turnId: string;
  /** The line saying what changed — or what the undo did. */
  summary: string;
  /** The button's label; absent once undone. */
  action?: string;
}

export const UNDO_TURN_EVENT = 'bp-undo-turn';

const changesRenderer = {
  type: 'bp-changes',
  render(segment: ChangesSegment): HTMLElement {
    const root = document.createElement('div');
    root.className = 'bp-changes mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground';
    root.dataset['segmentId'] = segment.id;
    const text = document.createElement('span');
    text.className = 'bp-changes-summary min-w-0 flex-1';
    text.textContent = segment.summary;
    root.append(text);
    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      'bp-changes-undo inline-flex h-7 items-center rounded-md border px-2.5 text-xs text-foreground hover:bg-muted';
    button.textContent = segment.action ?? '';
    button.hidden = !segment.action;
    button.addEventListener('click', () => {
      button.disabled = true;
      root.dispatchEvent(
        new CustomEvent(UNDO_TURN_EVENT, {
          bubbles: true,
          composed: true,
          detail: { turnId: segment.turnId, segmentId: segment.id },
        }),
      );
    });
    root.append(button);
    return root;
  },
  update(element: HTMLElement, segment: ChangesSegment): void {
    const text = element.querySelector('.bp-changes-summary');
    if (text) text.textContent = segment.summary;
    const button = element.querySelector<HTMLButtonElement>('.bp-changes-undo');
    if (button) {
      button.textContent = segment.action ?? '';
      button.hidden = !segment.action;
      button.disabled = false;
    }
  },
};

/**
 * What each tool call targets, after its name in the row — `read_file
 * src/a.ts`, `run_shell pnpm test` — with the row's states, spinner and
 * disclosure kept (apartéJS 0.17.1). Which argument names the target, per
 * tool; nothing to name shows nothing.
 */
const TOOL_TARGETS: Record<string, string> = {
  read_file: 'path',
  write_file: 'path',
  edit_file: 'path',
  list_dir: 'path',
  grep_files: 'pattern',
  run_shell: 'command',
  web_search: 'query',
  web_fetch: 'url',
  browser_open: 'url',
};

function registerToolSummaries(): void {
  for (const [tool, argument] of Object.entries(TOOL_TARGETS)) {
    aparteGlobalConfig.registerToolSummary(tool, (segment) => {
      const value = segment.toolCall.input[argument];
      return typeof value === 'string' ? value : '';
    });
  }
}

/**
 * Built only once: the grammars are frozen and both themes are in it. The
 * JS regex engine avoids oniguruma's WASM (~620 KB), and the grammars
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
 * Installed once: since apartéJS 0.14.0 the provider takes a light/dark
 * pair and the rendered block follows core's `[data-aparte-theme]` switch
 * by itself — no re-registration on a theme change, no block left on the
 * wrong background.
 */
export async function bootstrapHighlighting(): Promise<void> {
  setupShikiProviderFromHighlighter(await ensureHighlighter(), {
    theme: { light: 'github-light', dark: 'github-dark' },
  });
}
