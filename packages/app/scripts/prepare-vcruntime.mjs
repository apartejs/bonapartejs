/**
 * Before the app is packed on Windows: the Visual C++ runtime llama.cpp's official package needs and does not carry
 * (msvcp140, vcruntime140, vcruntime140_1) goes into `resources/vcruntime/`, taken from Visual Studio's
 * redistributable folder — the newest found, with a warning when older than what built llama.cpp. The core puts it beside the
 * llama.cpp it installs, on a Windows that has none as recent (`packages/core/src/engine/llama-runtime.ts`).
 *
 * Elsewhere than Windows there is nothing to carry. `BONAPARTE_VCRUNTIME_ROOTS` (folders separated by `;`) names the
 * `Microsoft Visual Studio` folders to search instead of the usual two.
 *
 * Node runs the TypeScript module it imports with its own type stripping (Node 24).
 */

import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_RUNTIME, RUNTIME_FILES, compareVersions, findCarriedRuntime } from '../src/main/vcruntime-source.ts';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'vcruntime');

if (process.platform !== 'win32') {
  console.log('Outside Windows the app carries no Visual C++ runtime.');
  process.exit(0);
}

const roots = process.env.BONAPARTE_VCRUNTIME_ROOTS
  ? process.env.BONAPARTE_VCRUNTIME_ROOTS.split(';').filter(Boolean)
  : [
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft Visual Studio'),
    ];

const found = await findCarriedRuntime(roots);
if (!found) {
  console.error(
    'No Visual C++ runtime in Visual Studio’s redistributable folder (VC\\Redist\\MSVC\\<version>\\x64\\Microsoft.VC14x.CRT).\n' +
      `Searched: ${roots.map((root) => `${root}\\<version>\\<edition>`).join(', ')} (Visual Studio 2026 is version 18,\n` +
      'under Program Files; 2022 and its Build Tools under Program Files (x86)). Set BONAPARTE_VCRUNTIME_ROOTS to search elsewhere.\n' +
      'Install Visual Studio Community, or its Build Tools, with the C++ workload: the app carries that runtime for llama.cpp.',
  );
  process.exit(1);
}
const version = found.version.join('.');
// Older than what built llama.cpp: carried all the same — a Windows with none is better served by a runtime one step
// behind than by none, and one too old says so (0xC0000139, « trop ancien », with Microsoft's installer). But loudly:
// the next pack should take a newer one.
if (compareVersions(found.version, MIN_RUNTIME) < 0) {
  console.warn(
    `WARNING: Visual Studio’s Visual C++ runtime is ${version}, older than ${MIN_RUNTIME.join('.')}, which built llama.cpp’s package.\n` +
      'It is carried all the same. Update Visual Studio (its installer, « Update »): Microsoft supports a runtime only as\n' +
      'recent as the toolset that built the program.',
  );
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of RUNTIME_FILES) await copyFile(join(found.dir, name), join(target, name));
// Its version only: the path of the machine that packed the app does not travel with it.
await writeFile(join(target, 'runtime.json'), `${JSON.stringify({ version }, null, 2)}\n`);
await writeFile(
  join(target, 'NOTICE.txt'),
  [
    'msvcp140.dll, vcruntime140.dll and vcruntime140_1.dll are the Microsoft Visual C++ runtime,',
    '(c) Microsoft Corporation. They travel with bonaparte unmodified, as Distributable Code of the',
    'Microsoft Visual Studio license terms (https://visualstudio.microsoft.com/license-terms/), and are',
    'not covered by bonaparte’s MIT license: their use is subject to Microsoft’s terms, which forbid',
    'modifying, reverse engineering or distributing them apart from this application.',
    '',
    'bonaparte puts them beside the llama.cpp it installs only on a Windows that has no Visual C++',
    'runtime as recent, and takes them away once Windows has one. Microsoft’s own installer, which',
    'Windows Update keeps current: https://aka.ms/vc14/vc_redist.x64.exe',
    '',
  ].join('\n'),
);
console.log(`The Visual C++ runtime ${version} is carried (from ${found.dir}).`);
