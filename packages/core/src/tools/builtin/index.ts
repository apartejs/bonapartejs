/**
 * The built-in tools, one file each. `ask_user` is not here: the window runs
 * it, and it arrives with the client's tools.
 */

import type { BuiltinTool } from './common.js';
import { editFile } from './edit-file.js';
import { listFiles } from './list-files.js';
import { readFileTool } from './read-file.js';
import { runCommand } from './run-command.js';
import { runSubagentTool } from './run-subagent.js';
import { search } from './search.js';
import { updatePlan } from './update-plan.js';
import { createWebFetch, type WebFetchOptions } from './web-fetch.js';
import { writeFileTool } from './write-file.js';

export type { BuiltinTool } from './common.js';

export interface BuiltinToolsDeps {
  /** What web_fetch fetches with, and the setting that lets local addresses through. */
  webFetch?: WebFetchOptions;
}

export function builtinTools(deps: BuiltinToolsDeps = {}): BuiltinTool[] {
  return [readFileTool, listFiles, search, editFile, writeFileTool, runCommand, createWebFetch(deps.webFetch), updatePlan, runSubagentTool];
}
