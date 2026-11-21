/**
 * The tests' temporary folder under its real name. GitHub's Windows runner spells it with an 8.3 short name
 * (`C:\Users\RUNNER~1\…`), while git, `realpath` and the perimeter read the long one (`C:\Users\runneradmin\…`):
 * a test that wrote one and expected the other failed there only (the first CI run, 2026-11-21). The folder a
 * person opens comes from the system's dialog, under its long name.
 */

import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

if (process.platform === 'win32') {
  const real = realpathSync.native(tmpdir());
  process.env.TEMP = real;
  process.env.TMP = real;
}
