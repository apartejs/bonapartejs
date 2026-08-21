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
 * Transport : la vue interroge `read({ since })` avec un curseur d'octets.
 * Notre SDK de plugin n'a pas encore de canal Node → vue pour POUSSER des
 * données ; c'est un manque connu, contourné par un polling adaptatif côté vue
 * (rapide quand ça débite, lent au repos).
 *
 * Différence assumée avec VS Code, qui résout le même problème proprement : il
 * fait tourner le PTY dans un PROCESS dédié, pousse les données, et applique
 * une contre-pression par acquittements — le client acquitte tous les 5 000
 * caractères, le PTY est mis en pause à 100 000 non acquittés et reprend sous
 * 5 000 (`FlowControlConstants`). Nous n'avons ni push ni acquittement : un
 * débit trop rapide élague le tampon, donc PERD de la sortie. On le signale
 * (`lost`) au lieu de laisser un trou muet, mais la vraie réponse est un
 * `ctx.emit()` avec acquittement dans le SDK.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { definePlugin, type PluginNodeContext } from '@aparte/bonaparte-plugin-sdk';

/** Fenêtre conservée : de quoi remonter un peu, pas un journal complet. */
const MAX_BUFFER_CHARS = 200_000;

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
  /** Sortie BRUTE, séquences ANSI comprises : xterm.js les interprète. */
  buffer: string;
  /** Octets déjà écartés du début du tampon — le curseur reste monotone. */
  dropped: number;
  exited: boolean;
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
        return {
          mode: session.mode,
          shellId: session.shellId,
          since: session.dropped,
          data: session.buffer,
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
        buffer: '',
        dropped: 0,
        exited: false,
      };
      pty.onData((data) => {
        live.buffer += data;
        if (live.buffer.length > MAX_BUFFER_CHARS) {
          const cut = live.buffer.length - MAX_BUFFER_CHARS;
          live.buffer = live.buffer.slice(cut);
          live.dropped += cut;
        }
      });
      pty.onExit(() => {
        live.exited = true;
      });
      session = live;
      ctx.log(`${shell.label} démarré (${live.mode}) dans ${workdir}`);
      return {
        mode: live.mode,
        shellId: shell.id,
        since: 0,
        data: '',
        exited: false,
      };
    });

    /**
     * Lit la sortie depuis un curseur d'OCTETS. Le curseur est monotone même
     * quand le tampon est élagué : la vue ne peut donc pas rejouer deux fois
     * les mêmes données, ni en sauter silencieusement.
     */
    ctx.registerCommand('read', async (payload) => {
      const { since = 0 } = (payload ?? {}) as { since?: number };
      if (!session) return { data: '', next: since, exited: true, mode: null };

      // Le tampon a-t-il élagué DEVANT le curseur du client ? Alors de la
      // sortie est perdue. VS Code n'a pas ce problème : il met le PTY en
      // pause (HighWatermarkChars = 100 000) et le reprend quand le client a
      // rattrapé, au lieu de jeter. Faute de canal de push, on jette — mais on
      // le DIT, plutôt que de laisser un trou muet dans le terminal.
      const lost = Math.max(0, session.dropped - since);
      const start = Math.max(0, since - session.dropped);
      const data = session.buffer.slice(start);
      return {
        data,
        lost,
        next: session.dropped + session.buffer.length,
        exited: session.exited,
        mode: session.mode,
      };
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
