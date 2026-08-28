import { describe, expect, it } from 'vitest';
import {
  aparteGlobalConfig,
  getSegmentRenderer,
  isSegmentSettled,
  type AparteSegment,
} from '@aparte/core';
import { bootstrapAparte, bootstrapHighlighting } from './aparte-bootstrap.js';

/** The segment types our loop actually emits (ChatScreen). */
const EMITTED = ['text', 'thinking', 'tool_call', 'error'] as const;

describe('aparté bootstrap', () => {
  it('registers the renderers for the segments we emit', () => {
    // History: the lib only registered its renderers in `AparteClient`'s
    // constructor — which bonaparte NEVER instantiates (invariant: no second
    // loop on the renderer side). Since 0.5.0-alpha.0 they install themselves
    // on the first segment; we keep the call and this test, because the
    // symptom ("[Unknown segment type: …]") was silent from the product's
    // point of view: the chat worked, only the CONTENT disappeared.
    bootstrapAparte();

    for (const type of EMITTED) {
      expect(getSegmentRenderer(type), `missing renderer: ${type}`).toBeDefined();
    }
  });

  it('installs a Markdown rendering engine', () => {
    // Without a provider, `renderMarkdown` returns the string UNCHANGED: the
    // model displays its asterisks and hashes as plain text. A coding agent
    // that replies in raw Markdown is unreadable.
    bootstrapAparte();

    const html = aparteGlobalConfig.renderMarkdown('**gras** et `code`');
    expect(html).toContain('<strong>');
    expect(html).toContain('<code>');
  });

  it('installs incremental Markdown rendering for streaming', () => {
    // The "one-shot" provider only serves finished messages. Without the
    // incremental provider, every token would re-parse the whole message:
    // exactly what we can't afford with a local model that streams for
    // minutes at a time.
    bootstrapAparte();

    const target = {} as HTMLElement;
    expect(aparteGlobalConfig.createStreamingMarkdownRenderer(target)).not.toBeNull();
  });

  it('installs syntax highlighting, asynchronously', async () => {
    // Building the highlighter is an `await`, kept OFF the first-render path.
    await bootstrapHighlighting();

    expect(aparteGlobalConfig.hasHighlightProvider()).toBe(true);
  });

  it('highlights the languages we chose to bundle', async () => {
    await bootstrapHighlighting();

    for (const lang of ['typescript', 'python', 'rust', 'bash', 'json']) {
      const html = await aparteGlobalConfig.highlightCode('const a = 1;', lang);
      expect(html, `no highlighting for ${lang}`).toContain('shiki');
    }
  });

  it('falls back to plain text on a missing language, without throwing', async () => {
    // ACCEPTED trade-off of the controlled bundle: our grammars are frozen.
    // What isn't bundled must not break the display — a model that replies
    // in Brainfuck stays readable.
    await bootstrapHighlighting();

    await expect(
      aparteGlobalConfig.highlightCode('++++[>++++<-]', 'brainfuck'),
    ).resolves.toBeTypeOf('string');
  });

  it('carries both themes in one render, so a theme switch needs no re-registration', async () => {
    // Since apartéJS 0.14.0 the provider takes a light/dark pair: the HTML
    // carries both palettes and follows core's `[data-aparte-theme]` switch
    // by itself. Before, the colours were frozen at render time and a theme
    // change had to re-register the provider — blocks already painted kept
    // the old background until their next render.
    await bootstrapHighlighting();
    const html = await aparteGlobalConfig.highlightCode('const a = 1;', 'typescript');

    expect(html).toContain('github-light');
    expect(html).toContain('github-dark');
  });
});

/**
 * Two rules of the lib that ChatScreen depends on DIRECTLY, and that changed
 * without anything breaking: the build passed, the tests passed, and the
 * behavior was wrong on screen. They are pinned here so that the next
 * contract change shows up red rather than in production.
 */
describe('lib contract the loop depends on', () => {
  it('a segment without `isStreaming` is NOT considered finished', () => {
    // This is why `finish()` calls `updateMessage(id, { status })`: it's the
    // only action that closes the turn's segments. Without it, the lib holds
    // them as forever in progress — no final Markdown pass, no highlighting
    // of the last code line.
    const open = { id: 's1', type: 'text', content: 'bonjour' } as AparteSegment;

    expect(isSegmentSettled(open)).toBe(false);
    expect(isSegmentSettled({ ...open, isStreaming: false })).toBe(true);
  });

  it('a reasoning segment without `collapsed` is COLLAPSED', () => {
    // Since 0.10.0, absence means closed (before, it meant open). Our
    // reasoning segment must therefore say `collapsed: false` explicitly,
    // otherwise the model thinks for a minute behind a closed block — the
    // empty screen we specifically wanted to avoid.
    bootstrapAparte();
    const renderer = getSegmentRenderer('thinking');
    const render = (segment: AparteSegment): string => {
      const out = renderer?.render(segment);
      return typeof out === 'string' ? out : (out?.outerHTML ?? '');
    };
    const base = { id: 's2', type: 'thinking', content: 'hmm' } as AparteSegment;

    expect(render(base)).not.toContain('open');
    expect(render({ ...base, collapsed: false } as AparteSegment)).toContain('open');
  });
});
