/**
 * The perimeter of a conversation: the folders of its project, or the home
 * folder without one — never the whole machine, never a network path. Where
 * a path really lands decides, not how it is spelled: a link or a junction
 * inside the project can lead anywhere, an 8.3 short name hides the long one,
 * a stream name is not a file.
 */

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runShort } from '../engine/process-probe.js';
import {
  displayInPerimeter,
  InvalidPathError,
  isInPerimeter,
  NetworkPathError,
  PathOutsideHomeError,
  PathOutsidePerimeterError,
  permissionPath,
  realLocation,
  resolveInPerimeter,
} from './paths.js';

let dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

async function folder(prefix = 'bp-perimeter-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe('resolveInPerimeter — without a project, the home folder', () => {
  it('reads a relative path from home, and takes an absolute one under it', () => {
    expect(resolveInPerimeter([], 'notes/today.md')).toBe(resolve(homedir(), 'notes/today.md'));
    const inside = join(homedir(), 'Documents', 'x.txt');
    expect(resolveInPerimeter([], inside)).toBe(inside);
  });

  it('refuses what lies outside home, and says why', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
    expect(() => resolveInPerimeter([], outside)).toThrow(PathOutsideHomeError);
    expect(() => resolveInPerimeter([], '../../..')).toThrow(/outside the home folder/);
  });
});

describe('resolveInPerimeter — the folders of a project', () => {
  it('reads a relative path from the first folder, in either separator', async () => {
    const root = await folder();
    expect(resolveInPerimeter([root], 'src/a.ts')).toBe(join(root, 'src', 'a.ts'));
    expect(resolveInPerimeter([root], 'src\\a.ts')).toBe(join(root, 'src', 'a.ts'));
    expect(resolveInPerimeter([root], '.')).toBe(resolve(root));
  });

  it('takes any of its folders, and a path that climbs into another one', async () => {
    const parent = await folder();
    const app = join(parent, 'app');
    const lib = join(parent, 'lib');
    await mkdir(app);
    await mkdir(lib);
    expect(resolveInPerimeter([app, lib], join(lib, 'x.ts'))).toBe(join(lib, 'x.ts'));
    expect(resolveInPerimeter([app, lib], '../lib/x.ts')).toBe(join(lib, 'x.ts'));
  });

  it('refuses a path that climbs out, a foreign absolute one, and a sibling that shares the prefix — naming the folders', async () => {
    const parent = await folder();
    const project = join(parent, 'project');
    await mkdir(project);
    expect(() => resolveInPerimeter([project], '../secret.txt')).toThrow(PathOutsidePerimeterError);
    expect(() => resolveInPerimeter([project], 'src/../../secret.txt')).toThrow(PathOutsidePerimeterError);
    expect(() => resolveInPerimeter([project], join(parent, 'project-secret', 'x'))).toThrow(PathOutsidePerimeterError);
    expect(() => resolveInPerimeter([project], '../x')).toThrow(new RegExp(project.replace(/\\/g, '\\\\')));
  });
});

describe('the real location decides, not the spelling', () => {
  it('a link or a junction inside the project that points outside is outside', async () => {
    const root = await folder();
    const outside = await folder('bp-outside-');
    try {
      await symlink(outside, join(root, 'escape'), 'junction');
    } catch {
      return; // links not allowed here
    }
    expect(() => resolveInPerimeter([root], 'escape/evil.txt')).toThrow(PathOutsidePerimeterError);
    expect(isInPerimeter([root], 'escape/evil.txt')).toBe(false);
  });

  it('a link that points nowhere yet is where it points, not where it stands: outside stays outside', async () => {
    const root = await folder();
    const outside = await folder('bp-outside-');
    try {
      await symlink(join(outside, 'not-yet'), join(root, 'escape'), 'junction');
    } catch {
      return; // links not allowed here
    }
    // A write through it would create the folder's content outside the project.
    expect(() => resolveInPerimeter([root], 'escape/evil.txt')).toThrow(PathOutsidePerimeterError);
    expect(isInPerimeter([root], 'escape/evil.txt')).toBe(false);
    expect(realLocation(join(root, 'escape', 'evil.txt'))).toBe(join(outside, 'not-yet', 'evil.txt'));
  });

  it('a relative link reached through another link is resolved from where it really stands', async () => {
    const root = await folder();
    const outside = await folder('bp-outside-');
    await mkdir(join(root, 'deep', 'er'), { recursive: true });
    try {
      // deep/er/back leads back to the project; evil points one folder above where it really stands.
      await symlink(root, join(root, 'deep', 'er', 'back'), 'junction');
      await symlink(join('..', basename(outside), 'evil.txt'), join(root, 'evil'), 'file');
    } catch {
      return; // a relative link needs a privilege on Windows: Linux and macOS run it
    }
    expect(() => resolveInPerimeter([root], 'deep/er/back/evil')).toThrow(PathOutsidePerimeterError);
  });

  it("a '..' after a link inside a link's target goes up from where that link really leads", async () => {
    const root = await folder();
    await mkdir(join(root, 'deep', 'er'), { recursive: true });
    try {
      // deep/er/back leads back to the project: back/.. is the project's parent, not deep/er.
      await symlink(root, join(root, 'deep', 'er', 'back'), 'junction');
      await symlink(join('deep', 'er', 'back', '..', 'bp-escaped.txt'), join(root, 'notes'), 'file');
    } catch {
      return; // a relative file link needs a privilege on Windows: Linux and macOS run it
    }
    expect(() => resolveInPerimeter([root], 'notes')).toThrow(PathOutsidePerimeterError);
  });

  it('a file link that points nowhere yet is where it points', async () => {
    const root = await folder();
    const outside = await folder('bp-outside-');
    try {
      await symlink(join(outside, 'autostart.desktop'), join(root, 'notes.md'), 'file');
    } catch {
      return; // file links need a privilege on Windows
    }
    expect(() => resolveInPerimeter([root], 'notes.md')).toThrow(PathOutsidePerimeterError);
  });

  it('a link that points nowhere yet, inside the project, stays inside — at its target', async () => {
    const root = await folder();
    await mkdir(join(root, 'src'));
    try {
      await symlink(join(root, 'src', 'later'), join(root, 'alias'), 'junction');
    } catch {
      return;
    }
    expect(resolveInPerimeter([root], 'alias/a.ts')).toBe(join(root, 'alias', 'a.ts'));
    expect(realLocation(join(root, 'alias', 'a.ts'))).toBe(join(root, 'src', 'later', 'a.ts'));
  });

  it.runIf(process.platform === 'win32')('a stream name is refused, never written beside the file', async () => {
    const root = await folder();
    expect(() => resolveInPerimeter([root], 'package.json::$DATA')).toThrow(InvalidPathError);
    expect(() => resolveInPerimeter([root], 'notes.txt:hidden')).toThrow(InvalidPathError);
  });

  it.runIf(process.platform === 'win32')('an 8.3 short name reaches the permission check as the long name it is', async () => {
    const root = await folder();
    await writeFile(join(root, 'package.json'), '{}', 'utf8');
    const listing = await runShort('cmd', ['/c', 'dir', '/x', root], 10_000);
    const short = listing?.stdout.match(/(PACKAG~\d\.JSO)/i)?.[1];
    if (!short) return; // short names off on this volume: nothing to alias
    expect(permissionPath([root], short).toLowerCase()).toMatch(/package\.json$/);
  });
});

describe('never a network path', () => {
  it('refuses a UNC path, in any spelling, and the device and long-path prefixes', async () => {
    const root = await folder();
    for (const unc of ['\\\\server\\share\\x.txt', '//server/share/x.txt', '\\\\?\\C:\\x.txt', '\\\\.\\PhysicalDrive0']) {
      expect(() => resolveInPerimeter([root], unc)).toThrow(NetworkPathError);
      expect(() => resolveInPerimeter([], unc)).toThrow(NetworkPathError);
      expect(isInPerimeter([root], unc)).toBe(false);
    }
  });

  it('refuses a perimeter that is itself on the network', () => {
    expect(() => resolveInPerimeter(['\\\\server\\share'], 'x.txt')).toThrow(NetworkPathError);
  });
});

describe('isInPerimeter', () => {
  it('answers without throwing: inside, outside, invalid', async () => {
    const root = await folder();
    expect(isInPerimeter([root], 'src/a.ts')).toBe(true);
    expect(isInPerimeter([root], '../x')).toBe(false);
  });
});

describe('displayInPerimeter', () => {
  it('shows a path from its folder; with several folders, the folder first; outside, whole', async () => {
    const parent = await folder();
    const app = join(parent, 'app');
    const lib = join(parent, 'lib');
    expect(displayInPerimeter([app], join(app, 'src', 'a.ts'))).toBe('src/a.ts');
    expect(displayInPerimeter([app], app)).toBe('.');
    expect(displayInPerimeter([app, lib], join(lib, 'x.ts'))).toBe('lib/x.ts');
    expect(displayInPerimeter([app], join(parent, 'other.ts'))).toBe(join(parent, 'other.ts'));
  });
});
