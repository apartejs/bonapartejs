/**
 * A plugin of a third party in a process of its own (task 11.1): the app and it talk by messages only. In the app,
 * `remoteModule` is the plugin as the host knows it — a `PluginNodeModule` whose context calls become messages; in
 * its process, `runPluginChild` loads the plugin's file and gives it a context made of messages. Neither side
 * imports Electron: the app gives the ports (a utility process's), and a test gives its own.
 *
 * What a plugin of a third party is given: its tools and its commands, its settings as they were when it started,
 * its log, the events of its view — and the core's own tools through `use`, judged as the host judges them. Not the
 * powers a built-in plugin has (start a program, open a terminal, search, the browser): what it would do with them
 * it does through `use`, within the effect its tool declares.
 */

import type { PluginNodeContext, PluginNodeModule, PluginToolInvocation, PluginToolResult, PluginToolUse } from '@aparte/bonaparte-shared';

/** What the app says to the plugin's process. */
export type ToPluginProcess =
  | { t: 'activate'; pluginId: string; file: string; config: Record<string, unknown> }
  | { t: 'call'; id: number; name: string; input: Record<string, unknown>; conversationId: string; roots: string[] }
  | { t: 'abort'; id: number }
  | { t: 'used'; id: number; result: PluginToolUse }
  | { t: 'command'; id: number; name: string; payload: unknown }
  | { t: 'dispose' };

/** What the plugin's process says to the app. */
export type FromPluginProcess =
  | { t: 'register-tool'; name: string }
  | { t: 'register-command'; name: string }
  | { t: 'ready' }
  | { t: 'failed'; error: string }
  | { t: 'result'; id: number; result: PluginToolResult }
  | { t: 'use'; id: number; callId: number; tool: string; input: Record<string, unknown> }
  | { t: 'command-result'; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: 'emit'; instanceId: string; event: string; payload: unknown }
  | { t: 'log'; message: string }
  | { t: 'disposed' };

/** The app's end of a plugin's process. */
export interface PluginPort {
  postMessage(message: ToPluginProcess): void;
  onMessage(listener: (message: FromPluginProcess) => void): void;
  /** The process ended: by itself (a code), or killed (null). */
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

/** The process's end. */
export interface PluginChildPort {
  postMessage(message: FromPluginProcess): void;
  onMessage(listener: (message: ToPluginProcess) => void): void;
}

const START_TIMEOUT_MS = 20_000;
const DISPOSE_GRACE_MS = 2_000;

/** A message's shape, checked before the host acts on it: a plugin's code can post anything on its port. */
function wellFormed(message: unknown): message is FromPluginProcess {
  if (typeof message !== 'object' || message === null) return false;
  const m = message as Record<string, unknown>;
  const text = (key: string): boolean => typeof m[key] === 'string';
  const num = (key: string): boolean => typeof m[key] === 'number';
  switch (m['t']) {
    case 'register-tool':
    case 'register-command':
      return text('name');
    case 'ready':
    case 'disposed':
      return true;
    case 'failed':
      return text('error');
    case 'result':
      return num('id') && typeof m['result'] === 'object' && m['result'] !== null;
    case 'use':
      return num('id') && num('callId') && text('tool') && typeof m['input'] === 'object' && m['input'] !== null;
    case 'command-result':
      return num('id') && typeof m['ok'] === 'boolean';
    case 'emit':
      return text('instanceId') && text('event');
    case 'log':
      return text('message');
    default:
      return false;
  }
}

/**
 * The plugin as the host knows it. `file` is the plugin's Node half; `settings` the keys whose values it starts
 * with; `onCrash` hears that its process ended while it was active — with the reason when the host stopped it for
 * a message it could not act on. Whatever the plugin posts, nothing it sends can throw in the app: a message of no
 * known shape, or one the host refuses (a tool its manifest does not declare, a tool registered twice), fails this
 * plugin alone.
 */
export function remoteModule(options: {
  start: () => PluginPort;
  file: string;
  settings: readonly string[];
  onCrash: (code: number | null, reason?: string) => void;
}): PluginNodeModule {
  return {
    activate: (ctx) =>
      new Promise<void>((resolve, reject) => {
        const port = options.start();
        let started = false;
        let disposing = false;
        let exited = false;
        let next = 0;
        const calls = new Map<number, { resolve: (result: PluginToolResult) => void; invocation: PluginToolInvocation }>();
        const commands = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
        let undone: (() => void) | null = null;
        let fault: string | null = null;

        const stop = (): void => {
          for (const call of calls.values()) call.resolve({ content: 'The plugin stopped before it answered.', failed: true });
          calls.clear();
          for (const command of commands.values()) command.reject(new Error('The plugin stopped before it answered.'));
          commands.clear();
        };
        const timer = setTimeout(() => {
          port.kill();
          reject(new Error(`The plugin did not start within ${START_TIMEOUT_MS / 1000} s.`));
        }, START_TIMEOUT_MS);

        port.onExit((code) => {
          exited = true;
          clearTimeout(timer);
          stop();
          undone?.();
          if (!started) reject(new Error(`The plugin's process stopped as it started${code === null ? '' : ` (code ${code})`}.`));
          else if (!disposing) options.onCrash(code, fault ?? undefined);
        });

        /** Stops the plugin for what it sent: before it is ready its start fails; after, it is torn down as a crash. */
        const misbehaved = (reason: string): void => {
          if (fault !== null) return;
          fault = reason;
          if (!started) {
            clearTimeout(timer);
            disposing = true;
            reject(new Error(reason));
          }
          port.kill();
        };

        port.onMessage((received) => {
          if (fault !== null) return;
          if (!wellFormed(received)) {
            misbehaved('It sent a message the app cannot read: stopped.');
            return;
          }
          try {
            act(received);
          } catch (error) {
            misbehaved(error instanceof Error ? error.message : String(error));
          }
        });

        const act = (message: FromPluginProcess): void => {
          switch (message.t) {
            case 'register-tool':
              ctx.registerToolHandler(message.name, (invocation) => {
                const id = (next += 1);
                return new Promise<PluginToolResult>((done) => {
                  calls.set(id, { resolve: done, invocation });
                  invocation.signal.addEventListener('abort', () => port.postMessage({ t: 'abort', id }));
                  port.postMessage({
                    t: 'call',
                    id,
                    name: message.name,
                    input: invocation.input,
                    conversationId: invocation.conversationId,
                    roots: [...invocation.roots],
                  });
                });
              });
              return;
            case 'register-command':
              ctx.registerCommand(message.name, (payload) => {
                const id = (next += 1);
                return new Promise((done, fail) => {
                  commands.set(id, { resolve: done, reject: fail });
                  port.postMessage({ t: 'command', id, name: message.name, payload });
                });
              });
              return;
            case 'result': {
              const call = calls.get(message.id);
              calls.delete(message.id);
              call?.resolve({ content: String(message.result.content ?? ''), ...(message.result.failed ? { failed: true } : {}) });
              return;
            }
            case 'use': {
              const call = calls.get(message.callId);
              const used = call ? call.invocation.use(message.tool, message.input) : Promise.resolve({ content: 'That call has ended.', failed: true });
              void used.then((result) => port.postMessage({ t: 'used', id: message.id, result }));
              return;
            }
            case 'command-result': {
              const command = commands.get(message.id);
              commands.delete(message.id);
              if (message.ok) command?.resolve(message.value);
              else command?.reject(new Error(message.error ?? 'The command failed.'));
              return;
            }
            case 'emit':
              if (message.instanceId) ctx.channel(message.instanceId).emit(message.event, message.payload);
              else ctx.emit(message.event, message.payload);
              return;
            case 'log':
              ctx.log(message.message);
              return;
            case 'ready':
              started = true;
              clearTimeout(timer);
              // Torn down by the host (switched off, removed, the app quitting): told first, then stopped.
              ctx.onDispose(() =>
                exited
                  ? undefined
                  : new Promise<void>((done) => {
                    disposing = true;
                    const grace = setTimeout(() => port.kill(), DISPOSE_GRACE_MS);
                    undone = () => {
                      clearTimeout(grace);
                      done();
                    };
                    port.postMessage({ t: 'dispose' });
                  }),
              );
              resolve();
              return;
            case 'disposed':
              port.kill();
              return;
            case 'failed':
              clearTimeout(timer);
              disposing = true;
              reject(new Error(message.error));
              port.kill();
              return;
          }
        };

        const config = Object.fromEntries(options.settings.map((key) => [key, ctx.getConfig(key)]));
        port.postMessage({ t: 'activate', pluginId: ctx.pluginId, file: options.file, config });
      }),
  };
}

/**
 * The process's side: loads the plugin's file and gives it its context. `load` imports the file (the process gives
 * `import()`, a test a module of its own).
 */
export function runPluginChild(port: PluginChildPort, load: (file: string) => Promise<unknown>): void {
  const tools = new Map<string, (call: PluginToolInvocation) => Promise<PluginToolResult>>();
  const commands = new Map<string, (payload: unknown) => unknown>();
  const calls = new Map<number, AbortController>();
  const uses = new Map<number, (result: PluginToolUse) => void>();
  const disposers: (() => void | Promise<void>)[] = [];
  const life = new AbortController();
  let nextUse = 0;

  port.onMessage((message) => {
    switch (message.t) {
      case 'activate':
        void activate(message.pluginId, message.file, message.config);
        return;
      case 'call': {
        const handler = tools.get(message.name);
        const controller = new AbortController();
        calls.set(message.id, controller);
        const invocation: PluginToolInvocation = {
          input: message.input,
          conversationId: message.conversationId,
          roots: message.roots,
          signal: controller.signal,
          use: (tool, input) =>
            new Promise((done) => {
              const id = (nextUse += 1);
              uses.set(id, done);
              port.postMessage({ t: 'use', id, callId: message.id, tool, input });
            }),
        };
        const answered = handler ? Promise.resolve().then(() => handler(invocation)) : Promise.resolve({ content: `The plugin has no tool ${message.name}.`, failed: true });
        void answered
          .then(
            (result) => ({ content: String(result?.content ?? ''), ...(result?.failed ? { failed: true } : {}) }),
            (error: unknown) => ({ content: `The tool failed: ${error instanceof Error ? error.message : String(error)}`, failed: true }),
          )
          .then((result) => {
            calls.delete(message.id);
            port.postMessage({ t: 'result', id: message.id, result });
          });
        return;
      }
      case 'abort':
        calls.get(message.id)?.abort();
        return;
      case 'used':
        uses.get(message.id)?.(message.result);
        uses.delete(message.id);
        return;
      case 'command': {
        const handler = commands.get(message.name);
        void Promise.resolve()
          .then(() => {
            if (!handler) throw new Error(`The plugin has no command ${message.name}.`);
            return handler(message.payload);
          })
          .then(
            (value) => port.postMessage({ t: 'command-result', id: message.id, ok: true, value }),
            (error: unknown) => port.postMessage({ t: 'command-result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
          );
        return;
      }
      case 'dispose':
        life.abort();
        void (async () => {
          for (const dispose of disposers.reverse()) {
            try {
              await dispose();
            } catch {
              // One that fails does not keep the others from running.
            }
          }
          port.postMessage({ t: 'disposed' });
        })();
        return;
    }
  });

  async function activate(pluginId: string, file: string, config: Record<string, unknown>): Promise<void> {
    try {
      const loaded = (await load(file)) as { default?: unknown; plugin?: unknown; activate?: unknown };
      const module = [loaded?.default, loaded?.plugin, loaded].find(
        (candidate): candidate is PluginNodeModule => typeof (candidate as PluginNodeModule | undefined)?.activate === 'function',
      );
      if (!module) throw new Error(`${file} exports no plugin: it must export an object with activate(ctx) (definePlugin).`);
      const channelOf = (instanceId: string) => ({
        emit: (event: string, payload: unknown) => {
          port.postMessage({ t: 'emit', instanceId, event, payload });
          return true;
        },
        onDrain: () => undefined,
        reset: () => undefined,
        dispose: () => undefined,
      });
      const ctx: PluginNodeContext = {
        pluginId,
        signal: life.signal,
        registerToolHandler: (name, handler) => {
          tools.set(name, handler);
          port.postMessage({ t: 'register-tool', name });
        },
        registerCommand: (name, handler) => {
          commands.set(name, handler);
          port.postMessage({ t: 'register-command', name });
        },
        getConfig: <T>(key: string) => config[key] as T | undefined,
        emit: (event, payload) => channelOf('').emit(event, payload),
        onDrain: () => undefined,
        channel: channelOf,
        onDispose: (dispose) => void disposers.push(dispose),
        log: (text) => port.postMessage({ t: 'log', message: String(text) }),
      };
      await module.activate(ctx);
      port.postMessage({ t: 'ready' });
    } catch (error) {
      port.postMessage({ t: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }
}
