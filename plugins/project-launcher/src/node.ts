/**
 * Lanceur de projet — moitié Node.
 *
 * Deux services : lister les scripts du projet ouvert (pour la vue ET pour
 * l'agent), et en lancer un en surveillant sa sortie pour y repérer l'URL du
 * serveur de développement. Détecter le port plutôt que de le deviner évite
 * de proposer une adresse qui n'écoute pas.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { definePlugin, type PluginNodeContext } from '@aparte/bonaparte-plugin-sdk';

interface ScriptEntry {
  name: string;
  command: string;
}

interface RunningScript {
  name: string;
  child: ChildProcess;
  output: string[];
  url: string | null;
  exitCode: number | null;
}

/** Première URL http(s) annoncée par un serveur de dev dans sa sortie. */
const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?[^\s"']*/i;

/** Sorties gardées par script : de quoi diagnostiquer, pas un journal complet. */
const MAX_LINES = 200;

async function readScripts(projectRoot: string): Promise<ScriptEntry[]> {
  try {
    const raw = await readFile(join(projectRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return Object.entries(parsed.scripts ?? {}).map(([name, command]) => ({
      name,
      command,
    }));
  } catch {
    return [];
  }
}

/** Gestionnaire de paquets déduit du lockfile — pas d'hypothèse gratuite. */
async function detectPackageManager(projectRoot: string): Promise<string> {
  const lockfiles: [string, string][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
  ];
  for (const [file, manager] of lockfiles) {
    try {
      await readFile(join(projectRoot, file), 'utf8');
      return manager;
    } catch {
      /* lockfile suivant */
    }
  }
  return 'npm';
}

export default definePlugin({
  activate(ctx: PluginNodeContext) {
    const running = new Map<string, RunningScript>();

    const stopAll = (): void => {
      for (const entry of running.values()) {
        try {
          entry.child.kill();
        } catch {
          /* déjà parti */
        }
      }
      running.clear();
    };

    // Les process lancés meurent avec le plugin : rien ne doit survivre à son
    // démontage, pas plus qu'à la fermeture de l'app.
    ctx.onDispose(stopAll);

    ctx.registerCommand('scripts', async (payload) => {
      const { projectRoot } = (payload ?? {}) as { projectRoot?: string };
      if (!projectRoot) return { scripts: [], manager: 'npm', running: [] };
      return {
        scripts: await readScripts(projectRoot),
        manager: await detectPackageManager(projectRoot),
        running: [...running.values()].map((entry) => ({
          name: entry.name,
          url: entry.url,
          exitCode: entry.exitCode,
          output: entry.output.slice(-40),
        })),
      };
    });

    ctx.registerCommand('run', async (payload) => {
      const { projectRoot, script } = (payload ?? {}) as {
        projectRoot?: string;
        script?: string;
      };
      if (!projectRoot || !script) throw new Error('projectRoot et script sont requis');
      if (running.has(script)) return { alreadyRunning: true };

      const manager = await detectPackageManager(projectRoot);
      const child = spawn(manager, ['run', script], {
        cwd: projectRoot,
        shell: process.platform === 'win32',
        windowsHide: true,
      });

      const entry: RunningScript = {
        name: script,
        child,
        output: [],
        url: null,
        exitCode: null,
      };
      running.set(script, entry);

      const absorb = (chunk: Buffer): void => {
        const text = chunk.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          entry.output.push(line);
          if (entry.output.length > MAX_LINES) entry.output.shift();
          if (!entry.url) {
            const found = URL_PATTERN.exec(line);
            if (found) entry.url = found[0];
          }
        }
      };
      child.stdout?.on('data', absorb);
      child.stderr?.on('data', absorb);
      child.on('exit', (code) => {
        entry.exitCode = code;
      });

      ctx.log(`${manager} run ${script}`);
      return { started: true };
    });

    ctx.registerCommand('stop', async (payload) => {
      const { script } = (payload ?? {}) as { script?: string };
      const entry = script ? running.get(script) : undefined;
      if (!entry) return { stopped: false };
      try {
        entry.child.kill();
      } catch {
        /* déjà parti */
      }
      running.delete(entry.name);
      return { stopped: true };
    });

    // Le même savoir, offert à l'agent : il n'a plus à deviner les commandes
    // du projet ni à lire package.json lui-même.
    ctx.registerToolHandler('list_project_scripts', async ({ projectRoot }) => {
      if (!projectRoot) {
        return {
          ok: false,
          content: 'No project folder is open, so there is no package.json to read.',
        };
      }
      const scripts = await readScripts(projectRoot);
      if (scripts.length === 0) {
        return { ok: true, content: 'The open project declares no scripts.' };
      }
      const manager = await detectPackageManager(projectRoot);
      return {
        ok: true,
        content: [
          `Package manager: ${manager}`,
          ...scripts.map((entry) => `- ${entry.name}: ${entry.command}`),
        ].join('\n'),
      };
    });
  },
});
