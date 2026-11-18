/**
 * Starting the process of a plugin of a third party (task 11.1): an Electron utility process — hidden, no console,
 * the app's environment without its secrets —, its end given to the core as a `PluginPort`. What it is given of the
 * app is its context; what it needs of the core it asks through `use`, judged as the agent's own calls.
 *
 * It is a Node process all the same: Node's permission model (`--permission`) is not honoured by Electron 45's
 * utility process (`process.permission` is undefined there, checked by `e2e/plugin-process.spec.ts`), so the
 * dialog that adds a plugin says what it is — code that runs on the machine, in a process apart.
 */

import type { FromPluginProcess, PluginPort, ToPluginProcess } from '@aparte/bonaparte-core';

/** What the app needs of Electron's utility process: injected, so that a test needs no Electron. */
export interface UtilityProcessLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  kill(): boolean;
}

export type ForkUtility = (modulePath: string, args: string[], options: { serviceName: string; stdio: 'ignore'; env: Record<string, string>; cwd: string }) => UtilityProcessLike;

export function pluginProcessStarter(options: { fork: ForkUtility; modulePath: string; env: () => Record<string, string> }) {
  return ({ pluginId, dir }: { pluginId: string; dir: string }): PluginPort => {
    const child = options.fork(options.modulePath, [], {
      serviceName: `bonaparte-plugin-${pluginId}`,
      stdio: 'ignore',
      env: options.env(),
      cwd: dir,
    });
    let gone = false;
    const exits: ((code: number | null) => void)[] = [];
    child.on('exit', (code) => {
      const killed = gone;
      gone = true;
      for (const listener of exits) listener(killed ? null : code);
    });
    return {
      postMessage: (message: ToPluginProcess) => {
        if (!gone) child.postMessage(message);
      },
      onMessage: (listener) => child.on('message', (message) => listener(message as FromPluginProcess)),
      onExit: (listener) => void exits.push(listener),
      kill: () => {
        if (gone) return;
        gone = true;
        child.kill();
      },
    };
  };
}
