/**
 * Terminal — moitié Node.
 *
 * `node-pty` donne un vrai pseudo-terminal (programmes interactifs, taille de
 * fenêtre), mais c'est un binding NATIF : il doit être recompilé pour l'ABI
 * d'Electron, et sur une machine où ça n'a pas été fait, `import` échoue.
 *
 * Le plugin ne parie donc pas dessus. Il le tente, et à défaut retombe sur un
 * shell lancé en process ordinaire : on y exécute des commandes et on lit leur
 * sortie, sans les programmes plein écran. La vue le DIT, plutôt que de
 * laisser croire à un terminal complet qui se comporterait bizarrement.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { definePlugin, type PluginNodeContext } from '@aparte/bonaparte-plugin-sdk';

/** Lignes conservées : de quoi suivre, pas un journal complet. */
const MAX_LINES = 500;

interface PtyLike {
  write(data: string): void;
  resize?(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
}

type Mode = 'pty' | 'basique';

function defaultShell(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: process.env['COMSPEC'] ?? 'powershell.exe', args: [] };
  }
  return { command: process.env['SHELL'] ?? '/bin/bash', args: ['-i'] };
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
  cwd: string,
): Promise<{ pty: PtyLike; mode: Mode } | null> {
  try {
    // Spécificateur calculé : le compilateur ne doit pas exiger que le
    // paquet existe, puisque tout l'intérêt est qu'il puisse manquer.
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
    const shell = defaultShell();
    const process_ = nodePty.spawn(shell.command, shell.args, {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd,
    });
    return {
      mode: 'pty',
      pty: {
        write: (data) => process_.write(data),
        resize: (cols, rows) => process_.resize(cols, rows),
        kill: () => process_.kill(),
        onData: (listener) => process_.onData(listener),
        onExit: (listener) => process_.onExit((event) => listener(event.exitCode)),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Séquences ANSI retirées côté Node : la vue affiche du texte, pas un
 * émulateur VT. Les garder produirait des caractères parasites à l'écran.
 */
// Les motifs sont construits plutôt qu'écrits en littéral : un caractère de
// contrôle dans un fichier source ne survit pas aux allers-retours d'édition,
// et un littéral corrompu donnerait un filtre silencieusement faux.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
/** Séquences CSI : couleurs et déplacements — ESC [ … lettre. */
const csi = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');
/** Séquences OSC : titre de fenêtre & co — ESC ] … BEL. */
const osc = new RegExp(`${ESC}\\][^${BEL}]*${BEL}`, 'g');
/**
 * Séquences ANSI retirées côté Node : la vue affiche du texte, pas un
 * émulateur VT. Les garder produirait des caractères parasites à l'écran.
 */
function stripAnsi(text: string): string {
  return text.replace(csi, '').replace(osc, '');
}

export default definePlugin({
  activate(ctx: PluginNodeContext) {
    let session: { pty: PtyLike; mode: Mode; lines: string[]; exited: boolean } | null = null;

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

    ctx.registerCommand('open', async (payload) => {
      const { cwd } = (payload ?? {}) as { cwd?: string };
      if (session) return { mode: session.mode, lines: session.lines };

      const workdir = cwd ?? process.cwd();
      const attempt = await tryPty(workdir);
      const started =
        attempt ??
        (() => {
          const shell = defaultShell();
          const child = spawn(shell.command, shell.args, {
            cwd: workdir,
            windowsHide: true,
          });
          return { pty: wrapChild(child), mode: 'basique' as const };
        })();

      const lines: string[] = [];
      const live = { pty: started.pty, mode: started.mode, lines, exited: false };
      started.pty.onData((data) => {
        for (const line of stripAnsi(data).split(/\r?\n/)) {
          lines.push(line);
          if (lines.length > MAX_LINES) lines.shift();
        }
      });
      started.pty.onExit(() => {
        live.exited = true;
      });
      session = live;
      ctx.log(`shell démarré (${started.mode}) dans ${workdir}`);
      return { mode: started.mode, lines };
    });

    ctx.registerCommand('read', async () =>
      session
        ? { mode: session.mode, lines: session.lines, exited: session.exited }
        : { mode: null, lines: [], exited: true },
    );

    ctx.registerCommand('write', async (payload) => {
      const { data } = (payload ?? {}) as { data?: string };
      if (!session || data === undefined) return { written: false };
      // Ce que l'utilisateur tape est aussi affiché : sans PTY il n'y a pas
      // d'écho, et une commande envoyée dans le vide serait déroutante.
      if (session.mode === 'basique') session.lines.push(`$ ${data.trimEnd()}`);
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
