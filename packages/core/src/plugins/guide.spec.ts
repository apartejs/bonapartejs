/** The plugin guide (task 11.4): the model's copy and the people's copy say the same. */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { PLUGIN_GUIDE } from './guide.js';

describe('the plugin guide', () => {
  it('docs/plugin-guide.md is the guide the model reads', async () => {
    const people = await readFile(new URL('../../../../docs/plugin-guide.md', import.meta.url), 'utf8');
    expect(people.replace(/\r\n/g, '\n')).toBe(PLUGIN_GUIDE);
  });
});
