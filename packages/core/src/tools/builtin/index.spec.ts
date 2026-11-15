/**
 * The built-in tools, as the design document lists them (§9): their names —
 * the model's protocol, in English — and their effects, which the approval
 * policy reads. `ask_user` is the window's: it arrives with the client's
 * tools, not here.
 */

import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../registry.js';
import { builtinTools } from './index.js';

describe('builtinTools', () => {
  it('gives the tools of the design document, each with its effect', () => {
    const effects = Object.fromEntries(builtinTools().map((tool) => [tool.def.name, tool.def.effect]));
    expect(effects).toEqual({
      read_file: 'read',
      list_files: 'read',
      search: 'read',
      edit_file: 'write',
      write_file: 'write',
      run_command: 'execute',
      web_fetch: 'network',
      update_plan: 'ui',
    });
  });

  it('are built-in tools of the core, described in English', () => {
    for (const { def } of builtinTools()) {
      expect(def.source).toBe('builtin');
      expect(def.where).toBe('core');
      expect(def.description).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('all go in one registry', () => {
    const registry = new ToolRegistry();
    for (const tool of builtinTools()) registry.register(tool.def, tool.handler);
    expect(registry.list()).toHaveLength(8);
  });
});
