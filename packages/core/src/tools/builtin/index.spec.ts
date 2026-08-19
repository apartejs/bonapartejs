import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolContext, ToolResult } from '../types.js';
import { builtinTools, MAX_TOOL_OUTPUT_CHARS } from './index.js';

let roots: string[] = [];

async function project(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bp-tools-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
  return root;
}

afterEach(async () => {
  // Sous Windows, un process tué (test de timeout) garde son cwd verrouillé
  // quelques instants : on réessaie, et un échec de ménage ne doit jamais
  // faire tomber un test.
  await Promise.all(
    roots.map((r) =>
      rm(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
        () => undefined,
      ),
    ),
  );
  roots = [];
});

function ctx(projectRoot: string): ToolContext {
  return { projectRoot, signal: new AbortController().signal };
}

async function call(
  name: string,
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  const tool = builtinTools().find((t) => t.def.name === name);
  if (!tool) throw new Error(`outil absent du kit : ${name}`);
  return tool.handler(args, ctx(projectRoot));
}

describe('kit d’outils', () => {
  it('expose les outils attendus avec un effet déclaré', () => {
    const byName = new Map(builtinTools().map((t) => [t.def.name, t.def]));
    expect([...byName.keys()].sort()).toEqual([
      'edit_file',
      'grep_files',
      'list_dir',
      'read_file',
      'run_shell',
      'write_file',
    ]);
    expect(byName.get('read_file')!.effect).toBe('read');
    expect(byName.get('write_file')!.effect).toBe('write');
    expect(byName.get('edit_file')!.effect).toBe('write');
    expect(byName.get('run_shell')!.effect).toBe('execute');
  });

  it('chaque outil décrit ses arguments en JSON Schema objet', () => {
    for (const { def } of builtinTools()) {
      expect(def.inputSchema['type']).toBe('object');
      expect(def.description.length).toBeGreaterThan(10);
    }
  });
});

describe('read_file', () => {
  it('lit un fichier du projet', async () => {
    const root = await project({ 'src/a.ts': 'const a = 1;' });
    const res = await call('read_file', { path: 'src/a.ts' }, root);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('const a = 1;');
  });

  it('signale un fichier absent sans lever', async () => {
    const root = await project();
    const res = await call('read_file', { path: 'fantome.ts' }, root);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/fantome\.ts/);
  });

  it('refuse de sortir du projet, proprement', async () => {
    const root = await project();
    const res = await call('read_file', { path: '../secrets.txt' }, root);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/project/i);
  });

  it('tronque un fichier démesuré en le signalant', async () => {
    const root = await project({ 'gros.txt': 'x'.repeat(MAX_TOOL_OUTPUT_CHARS + 500) });
    const res = await call('read_file', { path: 'gros.txt' }, root);
    expect(res.ok).toBe(true);
    expect(res.content.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 300);
    expect(res.content).toMatch(/truncated/i);
  });

  it('lit une tranche avec offset et limit', async () => {
    const root = await project({ 'l.txt': 'l1\nl2\nl3\nl4\nl5' });
    const res = await call('read_file', { path: 'l.txt', offset: 2, limit: 2 }, root);
    expect(res.content).toContain('l2');
    expect(res.content).toContain('l3');
    expect(res.content).not.toContain('l5');
  });
});

describe('write_file', () => {
  it('écrit et crée les dossiers manquants', async () => {
    const root = await project();
    const res = await call(
      'write_file',
      { path: 'a/b/c.txt', content: 'coucou' },
      root,
    );
    expect(res.ok).toBe(true);
    expect(await readFile(join(root, 'a/b/c.txt'), 'utf8')).toBe('coucou');
  });

  it('écrase un fichier existant', async () => {
    const root = await project({ 'a.txt': 'avant' });
    await call('write_file', { path: 'a.txt', content: 'après' }, root);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('après');
  });

  it('refuse d’écrire hors du projet', async () => {
    const root = await project();
    const res = await call(
      'write_file',
      { path: '../evasion.txt', content: 'x' },
      root,
    );
    expect(res.ok).toBe(false);
  });

  it('exige un contenu de type chaîne', async () => {
    const root = await project();
    const res = await call('write_file', { path: 'a.txt', content: 42 }, root);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/content/);
  });
});

describe('edit_file', () => {
  it('remplace une occurrence unique', async () => {
    const root = await project({ 'a.ts': 'let x = 1;\nlet y = 2;' });
    const res = await call(
      'edit_file',
      { path: 'a.ts', old_string: 'let x = 1;', new_string: 'const x = 1;' },
      root,
    );
    expect(res.ok).toBe(true);
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('const x = 1;\nlet y = 2;');
  });

  it('refuse si le motif est absent', async () => {
    const root = await project({ 'a.ts': 'rien' });
    const res = await call(
      'edit_file',
      { path: 'a.ts', old_string: 'introuvable', new_string: 'x' },
      root,
    );
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/not found|no occurrence/i);
  });

  it('refuse si le motif est ambigu (plusieurs occurrences)', async () => {
    const root = await project({ 'a.ts': 'dup\ndup' });
    const res = await call(
      'edit_file',
      { path: 'a.ts', old_string: 'dup', new_string: 'x' },
      root,
    );
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/2/);
    // Le fichier ne doit pas avoir bougé.
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('dup\ndup');
  });
});

describe('list_dir', () => {
  it('liste le contenu en distinguant les dossiers', async () => {
    const root = await project({ 'src/a.ts': '', 'README.md': '' });
    const res = await call('list_dir', {}, root);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('src/');
    expect(res.content).toContain('README.md');
  });

  it('signale un dossier absent', async () => {
    const root = await project();
    const res = await call('list_dir', { path: 'nulle-part' }, root);
    expect(res.ok).toBe(false);
  });
});

describe('grep_files', () => {
  it('trouve les lignes correspondantes avec fichier et numéro', async () => {
    const root = await project({
      'a.ts': 'const cible = 1;\nautre',
      'b.ts': 'rien',
    });
    const res = await call('grep_files', { pattern: 'cible' }, root);
    expect(res.ok).toBe(true);
    expect(res.content).toMatch(/a\.ts:1/);
    expect(res.content).not.toContain('b.ts');
  });

  it('accepte une expression régulière', async () => {
    const root = await project({ 'a.ts': 'foo123bar' });
    const res = await call('grep_files', { pattern: 'foo\\d+bar' }, root);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('a.ts');
  });

  it('signale une regex invalide sans lever', async () => {
    const root = await project({ 'a.ts': 'x' });
    const res = await call('grep_files', { pattern: '([' }, root);
    expect(res.ok).toBe(false);
  });

  it('dit clairement quand rien ne correspond', async () => {
    const root = await project({ 'a.ts': 'x' });
    const res = await call('grep_files', { pattern: 'zzz' }, root);
    expect(res.ok).toBe(true);
    expect(res.content).toMatch(/no match/i);
  });
});

describe('run_shell', () => {
  it('exécute une commande et capture sa sortie', async () => {
    const root = await project();
    const res = await call('run_shell', { command: 'echo bonaparte' }, root);
    expect(res.ok).toBe(true);
    expect(res.content).toContain('bonaparte');
  });

  it('rapporte un code de sortie non nul sans lever', async () => {
    const root = await project();
    const res = await call('run_shell', { command: 'exit 3' }, root);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/3/);
  });

  it('s’exécute à la racine du projet', async () => {
    const root = await project({ 'marqueur.txt': '' });
    const command = process.platform === 'win32' ? 'dir /b' : 'ls';
    const res = await call('run_shell', { command }, root);
    expect(res.content).toContain('marqueur.txt');
  });

  it('interrompt une commande qui dépasse le délai', async () => {
    const root = await project();
    const command =
      process.platform === 'win32'
        ? 'ping -n 20 127.0.0.1 > nul'
        : 'sleep 20';
    const res = await call('run_shell', { command, timeout_ms: 300 }, root);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/timeout/i);
  }, 15_000);

  it('exige une commande non vide', async () => {
    const root = await project();
    const res = await call('run_shell', { command: '   ' }, root);
    expect(res.ok).toBe(false);
  });
});

describe('sans projet ouvert', () => {
  it('les outils existent quand même et lisent un chemin absolu', async () => {
    // Le projet est le PÉRIMÈTRE des outils, pas leur condition d'existence :
    // discuter sans dossier ne doit pas priver l'agent de savoir lire.
    const dir = await project({ 'note.txt': 'contenu hors projet' });
    const file = join(dir, 'note.txt');

    const read = builtinTools().find((t) => t.def.name === 'read_file')!;
    const result = await read.handler(
      { path: file },
      { signal: new AbortController().signal },
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain('contenu hors projet');
  });
});
