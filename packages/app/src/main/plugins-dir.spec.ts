import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePluginsDir } from './plugins-dir.js';

const base = {
  appPath: join('C:', 'work', 'packages', 'app'),
  resourcesPath: join('C:', 'work', 'resources'),
  isPackaged: false,
  env: {} as Record<string, string | undefined>,
  exists: () => false,
};

describe('resolvePluginsDir', () => {
  it('honours BONAPARTE_PLUGINS_DIR before anything else', () => {
    const dir = join('D:', 'my-plugins');
    expect(resolvePluginsDir({ ...base, env: { BONAPARTE_PLUGINS_DIR: dir } })).toBe(dir);
  });

  it('uses the resources folder of a packaged app', () => {
    expect(resolvePluginsDir({ ...base, isPackaged: true })).toBe(
      join(base.resourcesPath, 'plugins'),
    );
  });

  it('prefers a plugins folder shipped next to the app (the assembled layout of the CLI)', () => {
    // `npx @aparte/bonaparte` runs an app directory assembled inside the CLI
    // package: the plugins travel with it, under the app path.
    const shipped = join(base.appPath, 'plugins');
    expect(resolvePluginsDir({ ...base, exists: (p) => p === shipped })).toBe(shipped);
  });

  it('falls back to the monorepo layout in development', () => {
    // packages/app → ../../plugins at the repository root.
    expect(resolvePluginsDir(base)).toBe(join(base.appPath, '..', '..', 'plugins'));
  });
});
