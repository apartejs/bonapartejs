/** The counts of a change, as aparté's diff counts them. */

import { describe, expect, it } from 'vitest';
import { countLines, total } from './changes';

describe('the counts of a change', () => {
  it('counts the lines added and removed; a created file is all added', () => {
    expect(countLines('first\n', 'second\n')).toEqual({ added: 1, removed: 1 });
    expect(countLines(null, 'fresh')).toEqual({ added: 1, removed: 0 });
    expect(countLines(null, null)).toEqual({ added: 0, removed: 0 });
    expect(total([{ added: 1, removed: 1 }, { added: 1, removed: 0 }])).toEqual({ added: 2, removed: 1 });
  });
});
