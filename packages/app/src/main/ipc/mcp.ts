/**
 * The MCP servers' channels (task 10.5): the core keeps them; the window only asks. A file that does not read is
 * said as such, never written over.
 */

import type { Core } from '@aparte/bonaparte-core';
import { mcpAdd, mcpOverview, mcpPaste, mcpRemove, mcpStart, mcpStop } from '@aparte/bonaparte-shared';
import type { IpcRegistry } from './register.js';

const unreadable = (error: unknown): boolean => error instanceof Error && error.name === 'McpFileUnreadableError';

export function registerMcpChannels(ipc: IpcRegistry, core: Pick<Core, 'mcp'>): void {
  ipc.handle(mcpOverview, () => core.mcp.overview());
  ipc.handle(mcpStart, async ({ id }) => {
    await core.mcp.start(id);
    return core.mcp.overview();
  });
  ipc.handle(mcpStop, async ({ id }) => {
    await core.mcp.stop(id);
    return core.mcp.overview();
  });
  ipc.handle(mcpRemove, async ({ id }) => {
    await core.mcp.remove(id);
    return core.mcp.overview();
  });
  ipc.handle(mcpPaste, async ({ text }) => {
    try {
      const { added, errors } = await core.mcp.paste(text);
      return { ok: true as const, added, errors: errors.map((error) => ({ id: error.id, code: error.code })) };
    } catch (error) {
      if (unreadable(error)) return { ok: false as const, error: 'unreadable' as const };
      throw error;
    }
  });
  ipc.handle(mcpAdd, async (input) => {
    try {
      return await core.mcp.add({ name: input.name, target: input.target, ...(input.projectId ? { projectId: input.projectId } : {}) });
    } catch (error) {
      if (unreadable(error)) return { ok: false as const, error: 'unreadable' as const };
      throw error;
    }
  });
}
