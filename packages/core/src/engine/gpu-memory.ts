/**
 * The video memory of the card — what a load is announced against. On
 * Windows the display adapters' class in the registry holds it, per adapter,
 * as a 64-bit value (`HardwareInformation.qwMemorySize`; the 32-bit
 * `AdapterRAM` of WMI stops at 4 GiB). The largest adapter is the one the
 * engine runs on. Elsewhere it is unknown, and said so — never zero.
 *
 * What the other programs hold right now (a game) is another figure: the
 * resource monitor's.
 */

import { spawnHidden, type SpawnFn } from '../process/spawn.js';

const DISPLAY_CLASS = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*';

const SCRIPT = [
  `$sizes = Get-ItemProperty -Path '${DISPLAY_CLASS}' -Name 'HardwareInformation.qwMemorySize' -ErrorAction SilentlyContinue |`,
  "  ForEach-Object { [uint64]$_.'HardwareInformation.qwMemorySize' }",
  'if ($sizes) { ($sizes | Measure-Object -Maximum).Maximum }',
].join('\n');

export interface GpuMemoryOptions {
  platform?: NodeJS.Platform;
  /** Injected in tests: what spawnHidden launches with. */
  spawn?: SpawnFn;
}

export async function readGpuMemoryBytes(options: GpuMemoryOptions = {}): Promise<number | null> {
  if ((options.platform ?? process.platform) !== 'win32') return null;
  const output = await new Promise<string | null>((resolve) => {
    let child;
    try {
      child = spawnHidden('powershell', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], {
        stdio: ['ignore', 'pipe', 'ignore'],
        ...(options.spawn ? { spawn: options.spawn } : {}),
      });
    } catch {
      resolve(null);
      return;
    }
    let text = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 15_000);
    child.stdout?.on('data', (chunk: Buffer | string) => (text += chunk.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(text);
    });
  });
  const bytes = Number((output ?? '').trim());
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}
