import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  displayInPerimeter,
  displayPath,
  PathOutsidePerimeterError,
  PathOutsideProjectError,
  resolveInPerimeter,
  resolveInProject,
} from './paths.js';

const ROOT = resolve('/projects/bonaparte');

describe('resolveInProject', () => {
  it('resolves a simple relative path', () => {
    expect(resolveInProject(ROOT, 'src/index.ts')).toBe(join(ROOT, 'src/index.ts'));
  });

  it('accepts POSIX separators as well as Windows', () => {
    expect(resolveInProject(ROOT, 'src\\index.ts')).toBe(
      resolveInProject(ROOT, 'src/index.ts'),
    );
  });

  it('normalizes redundant segments', () => {
    expect(resolveInProject(ROOT, './src/../src/a.ts')).toBe(join(ROOT, 'src/a.ts'));
  });

  it('accepts the root itself', () => {
    expect(resolveInProject(ROOT, '.')).toBe(ROOT);
  });

  it('accepts an absolute path located inside the project', () => {
    const inside = join(ROOT, 'src/a.ts');
    expect(resolveInProject(ROOT, inside)).toBe(inside);
  });

  it('refuses climbing outside the project', () => {
    expect(() => resolveInProject(ROOT, '../secrets.txt')).toThrow(
      PathOutsideProjectError,
    );
  });

  it('refuses a disguised climb in the middle of the path', () => {
    expect(() => resolveInProject(ROOT, 'src/../../secrets.txt')).toThrow(
      PathOutsideProjectError,
    );
  });

  it('refuses a foreign absolute path', () => {
    expect(() => resolveInProject(ROOT, resolve('/etc/passwd'))).toThrow(
      PathOutsideProjectError,
    );
  });

  it('refuses a sibling directory with a common prefix', () => {
    // /projects/bonaparte-secret starts with the root as a string: a
    // naive prefix test would let it through.
    expect(() => resolveInProject(ROOT, `${ROOT}-secret/a.ts`)).toThrow(
      PathOutsideProjectError,
    );
  });

  it('the error message names the requested path', () => {
    expect(() => resolveInProject(ROOT, '../x')).toThrow(/\.\.\/x/);
  });
});

describe('displayPath', () => {
  it('renders a relative path with POSIX separators', () => {
    expect(displayPath(ROOT, join(ROOT, 'src', 'a.ts'))).toBe('src/a.ts');
  });

  it('renders "." for the root', () => {
    expect(displayPath(ROOT, ROOT)).toBe('.');
  });

  it('leaves an out-of-project path as-is (diagnostic)', () => {
    const outside = resolve('/elsewhere/a.ts');
    expect(displayPath(ROOT, outside).split(sep).join('/')).toContain('elsewhere');
  });
});

// ─── N-root perimeter ───────────────────────────────────────────────────

const A = resolve('/projects/alpha');
const B = resolve('/projects/beta');

describe('resolveInPerimeter', () => {
  describe('with no root — the project is the perimeter, not the condition', () => {
    it('resolves a relative path from the home folder', () => {
      const got = resolveInPerimeter([], 'notes.txt');
      expect(got).toBe(resolve(homedir(), 'notes.txt'));
    });

    it('lets an absolute path under the home folder through', () => {
      const inside = resolve(homedir(), 'code', 'x.txt');
      expect(resolveInPerimeter([], inside)).toBe(inside);
    });

    it('refuses what lands outside the home folder (Q-26: no project is not the whole machine)', () => {
      const outside = resolve(homedir(), '..', 'someone-else', 'x.txt');
      expect(() => resolveInPerimeter([], outside)).toThrow(PathOutsidePerimeterError);
      expect(() => resolveInPerimeter([], '../../etc/passwd')).toThrow(/home folder/);
    });
  });

  describe('a single root — behavior identical to before', () => {
    it('resolves a relative path inside the root', () => {
      expect(resolveInPerimeter([A], 'src/a.ts')).toBe(join(A, 'src/a.ts'));
    });

    it('refuses an escape via ..', () => {
      expect(() => resolveInPerimeter([A], '../secrets.txt')).toThrow(
        PathOutsidePerimeterError,
      );
    });

    it('refuses a foreign absolute path', () => {
      expect(() => resolveInPerimeter([A], B)).toThrow(PathOutsidePerimeterError);
    });
  });

  describe('multiple roots', () => {
    it('resolves a relative path against the FIRST root', () => {
      expect(resolveInPerimeter([A, B], 'src/a.ts')).toBe(join(A, 'src/a.ts'));
      // The order is semantic: reversing it changes the default root.
      expect(resolveInPerimeter([B, A], 'src/a.ts')).toBe(join(B, 'src/a.ts'));
    });

    it('accepts an absolute path located in any root', () => {
      expect(resolveInPerimeter([A, B], join(B, 'lib/b.ts'))).toBe(join(B, 'lib/b.ts'));
    });

    it('accepts a relative path that leaves the first root but lands in another', () => {
      // The perimeter is the UNION of the roots: what matters is where the
      // path lands, not by which detour it gets there.
      const got = resolveInPerimeter([A, B], '../beta/lib/b.ts');
      expect(got).toBe(join(B, 'lib/b.ts'));
    });

    it('refuses what lands in no root', () => {
      expect(() => resolveInPerimeter([A, B], resolve('/projects/gamma/x'))).toThrow(
        PathOutsidePerimeterError,
      );
    });

    it('the refusal NAMES the roots, so the model can correct itself', () => {
      let message = '';
      try {
        resolveInPerimeter([A, B], resolve('/projects/gamma/x'));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(A);
      expect(message).toContain(B);
    });
  });

  it('accepts Windows separators as well as POSIX', () => {
    expect(resolveInPerimeter([A], 'src\\a.ts')).toBe(
      resolveInPerimeter([A], 'src/a.ts'),
    );
  });
});

describe('displayInPerimeter', () => {
  it('with a single root, stays relative and plain', () => {
    expect(displayInPerimeter([A], join(A, 'src/a.ts'))).toBe('src/a.ts');
  });

  it('with multiple roots, prefixes the name of the containing root', () => {
    // Without this prefix, two "src/a.ts" files from two repos would be
    // indistinguishable in grep output.
    expect(displayInPerimeter([A, B], join(B, 'src/a.ts'))).toBe('beta/src/a.ts');
  });

  it('outside the perimeter, returns the absolute path rather than lying', () => {
    const ailleurs = resolve('/tmp/x.txt');
    expect(displayInPerimeter([A], ailleurs)).toBe(ailleurs);
  });

  it('with no root, returns the absolute path', () => {
    const p = resolve('/tmp/x.txt');
    expect(displayInPerimeter([], p)).toBe(p);
  });
});
