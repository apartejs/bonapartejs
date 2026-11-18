/**
 * The mascot (task 12.2, board « Logo et ses états »): its face is text in Georgia, never an image; its state is on
 * the element and in its name; its colours are the tokens'; only transform and opacity move, and nothing moves
 * under « réduire les animations ».
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Mascot } from './Mascot';

const css = readFileSync(join(import.meta.dirname, 'mascot.css'), 'utf8');
/** The text a person reads: tags out, entities read. */
const textOf = (html: string): string => html.replace(/<[^>]+>/g, '').replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&amp;', '&');

describe('the mascot', () => {
  it('draws its face as text, its bicorne as a path, its state on the element and in its name', () => {
    const html = renderToStaticMarkup(<Mascot state="waiting" label="Logo bonaparte, attend ton accord" />);
    expect(html).toContain('data-state="waiting"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Logo bonaparte, attend ton accord"');
    expect(html).not.toContain('<img');
    const face = textOf(html);
    expect(face).toContain("('.')");
    expect(html).toContain('M6 48C22 44 30 13 60 12C90 13 98 44 114 48C96 51 80 55 60 55C40 55 24 51 6 48Z');
  });

  it('changes its face with its state', () => {
    const face = (state: Parameters<typeof Mascot>[0]['state']) => textOf(renderToStaticMarkup(<Mascot state={state} label="x" />));
    expect(face('happy')).toContain('(ˆ.ˆ)');
    expect(face('surprised')).toContain('(°.°)');
    expect(face('error')).toContain('(x.x)');
    expect(face('sleeping')).toContain('(-.-)');
    expect(face('talking')).toContain("('o')");
  });

  it('reads its colours from the tokens, moves only transform and opacity, and stops under reduced motion', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(css).toMatch(/var\(--bonaparte-brass-face\)/);
    expect(css).toMatch(/var\(--bonaparte-hat\)/);
    const keyframes = [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?)\n\}/g)].map((match) => match[1]!);
    expect(keyframes.length).toBeGreaterThan(10);
    for (const body of keyframes) {
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
      for (const property of properties) expect(['transform', 'opacity']).toContain(property);
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*animation: none !important/);
  });
});
