/**
 * A stdio transport for the MCP SDK's client (task 10.5) that launches the server as every child process of
 * bonaparte is launched: hidden, with an argument array, never a shell (`spawnTree`, through `spawnHidden`).
 * The SDK's own `StdioClientTransport` spawns the process itself, past those rules. The framing is the SDK's:
 * one JSON-RPC message a line. Closing stops the whole tree — `npx` is a wrapper, the server its grandchild.
 */

import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { SpawnedProcess, SpawnFn } from '../process/spawn.js';
import { spawnTree, stopProcessTree } from '../process/tree.js';

export interface HiddenStdioParams {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd?: string;
  /** Tests only: what launches the process. */
  spawn?: SpawnFn;
}

export class HiddenStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private child: SpawnedProcess | undefined;
  private readonly buffer = new ReadBuffer();
  private closed = false;
  private readonly stderrListeners = new Set<(text: string) => void>();

  constructor(private readonly params: HiddenStdioParams) {}

  /** The server's process id while it runs: read live, never kept after it ended (a reused pid is never stopped). */
  get pid(): number | null {
    const child = this.child;
    return child && child.exitCode === null && child.signalCode === null ? (child.pid ?? null) : null;
  }

  /** What the server writes on stderr, as it writes it: the words that explain a failure. */
  onStderr(listener: (text: string) => void): void {
    this.stderrListeners.add(listener);
  }

  start(): Promise<void> {
    if (this.child) throw new Error('The transport is started already.');
    return new Promise((resolve, reject) => {
      const child = spawnTree(this.params.command, this.params.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.params.env,
        ...(this.params.cwd ? { cwd: this.params.cwd } : {}),
        ...(this.params.spawn ? { spawn: this.params.spawn } : {}),
      });
      this.child = child;
      child.once('error', (error) => {
        reject(error);
        this.onerror?.(error);
      });
      child.once('spawn', () => resolve());
      child.once('close', () => this.ended());
      child.stdout?.on('data', (chunk: Buffer) => {
        this.buffer.append(chunk);
        for (;;) {
          let message: JSONRPCMessage | null;
          try {
            message = this.buffer.readMessage();
          } catch (error) {
            this.onerror?.(error instanceof Error ? error : new Error(String(error)));
            continue;
          }
          if (!message) break;
          this.onmessage?.(message);
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        for (const listener of this.stderrListeners) listener(text);
      });
      child.stdin?.on('error', (error) => this.onerror?.(error));
    });
  }

  send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || this.closed) return Promise.reject(new Error('The server is not running.'));
    return new Promise((resolve, reject) => {
      stdin.write(serializeMessage(message), (error) => (error ? reject(error) : resolve()));
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (child) {
      child.stdin?.end();
      await stopProcessTree(child, this.params.spawn ? { spawn: this.params.spawn } : {});
    }
    this.ended();
  }

  private ended(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer.clear();
    this.onclose?.();
  }
}
