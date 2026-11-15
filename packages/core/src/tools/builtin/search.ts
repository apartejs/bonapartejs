/**
 * search: a regular expression across the files of the project, as
 * `path:line: text`. The walk and the matching run in a worker thread, apart
 * from the app (security rule 7): stopped with the turn, and by itself after
 * its time limit (10 s), so that an expression that backtracks for ever never
 * blocks anything. The worker gets its code as text: no worker file to find,
 * in the tests as in the packaged app.
 */

import { Worker } from 'node:worker_threads';
import { displayInPerimeter } from '../../project/paths.js';
import type { ToolOutput } from '../types.js';
import { describeError, inPerimeter, refused, SKIPPED_FOLDERS, text, type BuiltinTool } from './common.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_FILES = 5_000;
const MAX_HITS = 200;
const MAX_FILE_BYTES = 1_000_000;

/** The worker: walks the folders, skips what a build made and what is binary, matches line by line. */
const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { pattern, starts, skipped, maxFiles, maxHits, maxBytes } = workerData;
const regex = new RegExp(pattern);
const hits = [];
let files = 0;
let more = false;
const stack = [...starts].reverse();
walk: while (stack.length > 0) {
  const dir = stack.pop();
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const folders = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!skipped.includes(entry.name)) folders.push(full); continue; }
    if (!entry.isFile()) continue;
    if (++files > maxFiles) { more = true; break walk; }
    let content;
    try {
      if (fs.statSync(full).size > maxBytes) continue;
      content = fs.readFileSync(full, 'utf8');
    } catch { continue; }
    if (content.includes('\\u0000')) continue;
    const lines = content.split('\\n');
    for (let index = 0; index < lines.length; index++) {
      if (regex.test(lines[index])) {
        hits.push([full, index + 1, lines[index].replace(/\\r$/, '').slice(0, 300)]);
        if (hits.length >= maxHits) { more = true; break walk; }
      }
    }
  }
  stack.push(...folders.reverse());
}
parentPort.postMessage({ hits, more });
`;

type Hit = [path: string, line: number, text: string];

export function createSearchTool(options: { timeoutMs?: number } = {}): BuiltinTool {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    def: {
      name: 'search',
      description:
        'Search a regular expression in the files of the project (or of one of its folders) and return the lines that match, as path:line: text.',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'A JavaScript regular expression.' },
          path: { type: 'string', description: 'A folder to search in, relative to the project (the whole project by default).' },
        },
        required: ['pattern'],
      },
      effect: 'read',
      source: 'builtin',
      where: 'core',
    },
    handler: async (call, ctx) => {
      const pattern = text(call.input, 'pattern');
      if (!pattern) return refused('Missing argument: pattern.');
      try {
        new RegExp(pattern);
      } catch (error) {
        return refused(`Not a regular expression: ${describeError(error)}`);
      }
      const requested = text(call.input, 'path');
      let starts: string[];
      if (requested) {
        const resolved = inPerimeter(ctx, requested);
        if ('error' in resolved) return refused(resolved.error);
        starts = [resolved.path];
      } else {
        const resolved = inPerimeter(ctx, '.');
        if ('error' in resolved) return refused(resolved.error);
        starts = ctx.roots.length > 0 ? [...ctx.roots] : [resolved.path];
      }

      return new Promise<ToolOutput>((resolve) => {
        const worker = new Worker(WORKER, {
          eval: true,
          workerData: { pattern, starts, skipped: [...SKIPPED_FOLDERS], maxFiles: MAX_FILES, maxHits: MAX_HITS, maxBytes: MAX_FILE_BYTES },
        });
        let settled = false;
        const finish = (result: ToolOutput): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ctx.signal.removeEventListener('abort', onAbort);
          void worker.terminate();
          resolve(result);
        };
        const timer = setTimeout(
          () =>
            finish(
              refused(`The search was stopped after ${timeoutMs / 1000} s: its time limit. Narrow the pattern, or the folder.`),
            ),
          timeoutMs,
        );
        const onAbort = (): void => finish(refused('The search was stopped: the turn was stopped.'));
        ctx.signal.addEventListener('abort', onAbort, { once: true });
        if (ctx.signal.aborted) onAbort();
        worker.on('message', (message: { hits: Hit[]; more: boolean }) => {
          if (message.hits.length === 0) {
            finish({ content: 'No match.' });
            return;
          }
          const lines = message.hits.map(([path, line, found]) => `${displayInPerimeter(ctx.roots, path)}:${line}: ${found}`);
          if (message.more) lines.push(`[More matches were not shown: narrow the pattern, or the folder.]`);
          finish({ content: lines.join('\n') });
        });
        worker.on('error', (error) => finish(refused(`The search failed: ${describeError(error)}`)));
      });
    },
  };
}

export const search = createSearchTool();
