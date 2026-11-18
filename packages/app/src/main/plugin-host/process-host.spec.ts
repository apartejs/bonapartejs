/**
 * The process of a plugin of a third party (task 11.1), with a fork that records what is asked of it: no Electron.
 * One utility process per plugin, named after it, started in its folder, the app's environment given as the app
 * hands it (its secrets out); a crash is said with its code, a stop the app asked for without one.
 */

import { describe, expect, it } from 'vitest';
import { pluginProcessStarter, type ForkUtility, type UtilityProcessLike } from './process-host.js';

function rig() {
  const forks: { modulePath: string; options: Parameters<ForkUtility>[2]; child: ReturnType<typeof fakeChild> }[] = [];
  const fork: ForkUtility = (modulePath, _args, options) => {
    const child = fakeChild();
    forks.push({ modulePath, options, child });
    return child;
  };
  const start = pluginProcessStarter({ fork, modulePath: 'C:/app/out/main/plugin-process.js', env: () => ({ PATH: 'C:/bin' }) });
  return { forks, start };
}

function fakeChild() {
  const listeners = { message: [] as ((message: unknown) => void)[], exit: [] as ((code: number) => void)[] };
  const sent: unknown[] = [];
  let killed = false;
  const child: UtilityProcessLike & { sent: unknown[]; say(message: unknown): void; exit(code: number): void; killed(): boolean } = {
    sent,
    postMessage: (message) => void sent.push(message),
    on: ((event: 'message' | 'exit', listener: (value: never) => void) => void (listeners[event] as ((value: never) => void)[]).push(listener)) as UtilityProcessLike['on'],
    kill: () => {
      killed = true;
      listeners.exit.forEach((listener) => listener(0));
      return true;
    },
    say: (message) => listeners.message.forEach((listener) => listener(message)),
    exit: (code) => listeners.exit.forEach((listener) => listener(code)),
    killed: () => killed,
  };
  return child;
}

describe('the process of a plugin of a third party (task 11.1)', () => {
  it('one per plugin, named after it, started in its folder, with the environment the app gives', () => {
    const { forks, start } = rig();
    start({ pluginId: 'revue-pr', dir: 'C:/data/plugins/revue-pr' });
    expect(forks[0]).toMatchObject({
      modulePath: 'C:/app/out/main/plugin-process.js',
      options: { serviceName: 'bonaparte-plugin-revue-pr', stdio: 'ignore', env: { PATH: 'C:/bin' }, cwd: 'C:/data/plugins/revue-pr' },
    });
  });

  it('carries the messages both ways; a crash says its code; a stop the app asked for says none', () => {
    const { forks, start } = rig();
    const port = start({ pluginId: 'revue-pr', dir: 'C:/data/plugins/revue-pr' });
    const heard: unknown[] = [];
    const exits: (number | null)[] = [];
    port.onMessage((message) => heard.push(message));
    port.onExit((code) => exits.push(code));
    port.postMessage({ t: 'dispose' });
    forks[0]!.child.say({ t: 'ready' });
    expect(forks[0]!.child.sent).toEqual([{ t: 'dispose' }]);
    expect(heard).toEqual([{ t: 'ready' }]);
    forks[0]!.child.exit(3);
    expect(exits).toEqual([3]);

    const second = start({ pluginId: 'notes', dir: 'C:/data/plugins/notes' });
    const stopped: (number | null)[] = [];
    second.onExit((code) => stopped.push(code));
    second.kill();
    expect(forks[1]!.child.killed()).toBe(true);
    expect(stopped).toEqual([null]);
    // Nothing is sent to a process that is gone.
    second.postMessage({ t: 'dispose' });
    expect(forks[1]!.child.sent).toEqual([]);
  });
});
