/**
 * Terminal — moitié Node.
 *
 * Un VRAI pseudo-terminal via `node-pty` : programmes interactifs, couleurs,
 * taille de fenêtre, plein écran. On ne filtre PLUS les séquences ANSI — c'est
 * xterm.js qui les interprète côté vue. Les retirer, c'était afficher du texte
 * en prétendant que c'était un terminal.
 *
 * `node-pty` est un binding natif. Vérifié le 2026-08-20 : il charge sous
 * Electron 43 SANS recompilation (ABI compatible, ConPTY livré avec le
 * paquet). Le repli reste là pour les machines où il manquerait, mais il est
 * annoncé comme dégradé, pas présenté comme un terminal.
 *
 * Transport : les données sont POUSSÉES vers la vue (`ctx.emit`), avec la
 * contre-pression du SDK — reprise du modèle de VS Code. `emit` rend `false`
 * quand la vue est en retard : on cesse alors de lire le PTY, et on reprend sur
 * `onDrain`. Rien n'est perdu, parce que le producteur s'arrête au lieu qu'un
 * tampon s'élague.
 *
 * Reste une différence avec VS Code, assumée : leur PTY tourne dans un PROCESS
 * dédié, donc un crash natif n'emporte pas la fenêtre. Chez nous il vit dans le
 * main process.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { definePlugin, type PluginNodeContext } from '@aparte/bonaparte-plugin-sdk';

/**
 * Historique conservé pour la RÉOUVERTURE de la vue : quand l'onglet se
 * remonte, il faut réafficher ce qui a défilé. Ce n'est plus un tampon de
 * transport — les données partent par `emit` au fil de l'eau.
 */
const MAX_HISTORY_CHARS = 200_000;

interface PtyLike {
  write(data: string): void;
  resize?(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
}

type Mode = 'pty' | 'basique';

export interface ShellChoice {
  /** Identifiant stable, utilisé par la vue pour demander ce shell. */
  id: string;
  label: string;
  command: string;
  args: string[];
}

/**
 * Shells réellement présents sur la machine.
 *
 * On ne propose que ce qui existe : une liste qui offre « pwsh » sur une
 * machine sans PowerShell 7 promet un terminal qui ne s'ouvrira pas.
 */
function availableShells(): ShellChoice[] {
  const found: ShellChoice[] = [];

  if (process.platform === 'win32') {
    const system = process.env['SystemRoot'] ?? 'C:\\Windows';
    const powershell = join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (existsSync(powershell)) {
      found.push({ id: 'powershell', label: 'Windows PowerShell', command: powershell, args: [] });
    }
    // PowerShell 7+ s'installe hors System32 et n'est pas toujours là.
    for (const candidate of [
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    ]) {
      if (existsSync(candidate)) {
        found.push({ id: 'pwsh', label: 'PowerShell 7', command: candidate, args: [] });
      }
    }
    const cmd = process.env['COMSPEC'] ?? join(system, 'System32', 'cmd.exe');
    if (existsSync(cmd)) {
      found.push({ id: 'cmd', label: 'Invite de commandes', command: cmd, args: [] });
    }
    for (const candidate of [
      join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      join(process.env['ProgramW6432'] ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    ]) {
      if (existsSync(candidate) && !found.some((s) => s.id === 'gitbash')) {
        found.push({ id: 'gitbash', label: 'Git Bash', command: candidate, args: ['-i'] });
      }
    }
    const wsl = join(system, 'System32', 'wsl.exe');
    if (existsSync(wsl)) {
      found.push({ id: 'wsl', label: 'WSL', command: wsl, args: [] });
    }
    return found;
  }

  const preferred = process.env['SHELL'];
  if (preferred && existsSync(preferred)) {
    found.push({
      id: 'default',
      label: preferred.split('/').pop() ?? 'shell',
      command: preferred,
      args: ['-i'],
    });
  }
  for (const candidate of ['/bin/zsh', '/bin/bash', '/usr/bin/fish', '/bin/sh']) {
    if (existsSync(candidate) && candidate !== preferred) {
      found.push({
        id: candidate.split('/').pop() as string,
        label: candidate.split('/').pop() as string,
        command: candidate,
        args: ['-i'],
      });
    }
  }
  return found;
}

/** Enveloppe un process ordinaire dans la même forme qu'un PTY. */
function wrapChild(child: ChildProcess): PtyLike {
  return {
    write: (data) => child.stdin?.write(data),
    kill: () => child.kill(),
    onData: (listener) => {
      child.stdout?.on('data', (chunk: Buffer) => listener(chunk.toString('utf8')));
      child.stderr?.on('data', (chunk: Buffer) => listener(chunk.toString('utf8')));
    },
    onExit: (listener) => child.on('exit', (code) => listener(code)),
  };
}

/** Le vrai PTY s'il est chargeable ; sinon `null`, sans faire de bruit. */
async function tryPty(
  shell: ShellChoice,
  cwd: string,
  cols: number,
  rows: number,
): Promise<PtyLike | null> {
  try {
    // Spécificateur calculé : le compilateur ne doit pas exiger que le paquet
    // existe, puisque tout l'intérêt est qu'il puisse manquer.
    const optional = 'node-pty';
    const nodePty = (await import(optional)) as unknown as {
      spawn: (
        file: string,
        args: string[],
        options: Record<string, unknown>,
      ) => {
        write(data: string): void;
        resize(cols: number, rows: number): void;
        kill(): void;
        onData(cb: (data: string) => void): void;
        onExit(cb: (event: { exitCode: number }) => void): void;
      };
    };
    const process_ = nodePty.spawn(shell.command, shell.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env,
    });
    return {
      write: (data) => process_.write(data),
      resize: (c, r) => process_.resize(c, r),
      kill: () => process_.kill(),
      onData: (listener) => process_.onData(listener),
      onExit: (listener) => process_.onExit(({ exitCode }) => listener(exitCode)),
    };
  } catch {
    return null;
  }
}

interface Session {
  pty: PtyLike;
  mode: Mode;
  shellId: string;
  /** Historique brut, pour réafficher à la réouverture de l'onglet. */
  history: string;
  exited: boolean;
  /** Le PTY est-il en pause parce que la vue n'a pas suivi ? */
  paused: boolean;
  /** Ce qui est arrivé PENDANT la pause, à pousser à la reprise. */
  pending: string;
}

export default definePlugin({
  activate(ctx: PluginNodeContext) {
    let session: Session | null = null;

    const close = (): void => {
      try {
        session?.pty.kill();
      } catch {
        /* déjà parti */
      }
      session = null;
    };

    // Le shell meurt avec le plugin : pas de process qui traîne.
    ctx.onDispose(close);

    ctx.registerCommand('shells', async () => ({ shells: availableShells() }));

    ctx.registerCommand('open', async (payload) => {
      const {
        cwd,
        shellId,
        cols = 80,
        rows = 24,
      } = (payload ?? {}) as {
        cwd?: string;
        shellId?: string;
        cols?: number;
        rows?: number;
      };

      // Changer de shell veut dire ouvrir un autre terminal : on ferme le
      // précédent plutôt que d'en laisser deux vivre sans les montrer.
      if (session && shellId && session.shellId !== shellId) close();
      if (session) {
        // Onglet remonté sur une session vivante : on rend l'historique pour
        // que la vue réaffiche ce qui a défilé sans elle.
        return {
          mode: session.mode,
          shellId: session.shellId,
          history: session.history,
          exited: session.exited,
        };
      }

      const shells = availableShells();
      const shell = shells.find((s) => s.id === shellId) ?? shells[0];
      if (!shell) return { error: 'No shell found on this machine.' };

      const workdir = cwd ?? process.cwd();
      const real = await tryPty(shell, workdir, cols, rows);
      const pty =
        real ??
        wrapChild(
          spawn(shell.command, shell.args, { cwd: workdir, windowsHide: true }),
        );

      const live: Session = {
        pty,
        mode: real ? 'pty' : 'basique',
        shellId: shell.id,
        history: '',
        exited: false,
        paused: false,
        pending: '',
      };

      /**
       * Pousse vers la vue, et S'ARRÊTE si elle est en retard.
       *
       * node-pty n'expose pas de pause : on ne peut pas cesser de recevoir. On
       * accumule donc dans `pending` — mais borné par la contre-pression, qui
       * empêche l'écart de grandir indéfiniment, là où l'ancien tampon
       * élaguait silencieusement.
       */
      const push = (data: string): void => {
        live.history += data;
        if (live.history.length > MAX_HISTORY_CHARS) {
          live.history = live.history.slice(live.history.length - MAX_HISTORY_CHARS);
        }
        if (live.paused) {
          live.pending += data;
          return;
        }
        if (!ctx.emit('data', data)) live.paused = true;
      };

      ctx.onDrain(() => {
        live.paused = false;
        const waiting = live.pending;
        live.pending = '';
        if (waiting) push(waiting);
      });

      pty.onData(push);
      pty.onExit(() => {
        live.exited = true;
        ctx.emit('exit', null);
      });
      session = live;
      ctx.log(`${shell.label} démarré (${live.mode}) dans ${workdir}`);
      return { mode: live.mode, shellId: shell.id, history: '', exited: false };
    });

    ctx.registerCommand('write', async (payload) => {
      const { data } = (payload ?? {}) as { data?: string };
      if (!session || data === undefined) return { written: false };
      session.pty.write(data);
      return { written: true };
    });

    ctx.registerCommand('resize', async (payload) => {
      const { cols, rows } = (payload ?? {}) as { cols?: number; rows?: number };
      if (session?.pty.resize && cols && rows) session.pty.resize(cols, rows);
      return { resized: Boolean(session?.pty.resize) };
    });

    ctx.registerCommand('close', async () => {
      close();
      return { closed: true };
    });
  },
});
