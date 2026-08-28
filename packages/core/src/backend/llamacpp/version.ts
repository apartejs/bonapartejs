/**
 * Minimum llama.cpp version required by bonaparte.
 *
 * bonaparte emits options that only exist on recent builds: the slots API
 * (--slot-save-path, POST /slots/{id}?action=…), --cache-reuse, the
 * `-fa on|off|auto` form, --load-mode. Conservative threshold: b6000 — all
 * these options are verified present at that point (researched on
 * 2026-08-18); adjustable if a real test proves an older build works.
 */

export const MIN_LLAMA_BUILD = 6000;

/**
 * Extracts the build number from `--version` output, all formats: unified
 * CLI "b10217-ddd4ec142", historical "version: 3952 (abc123)", or
 * "llama-server b6521". null if not found.
 */
export function parseLlamaBuildNumber(versionOutput: string): number | null {
  // Prefixed form "b10217" (unified CLI, release tags, asset names).
  const tagged = versionOutput.match(/\bb(\d{3,6})\b/);
  if (tagged?.[1]) return Number.parseInt(tagged[1], 10);
  // Historical form "version: 3952 (hash)" / "build: 3952".
  const labeled = versionOutput.match(/\b(?:version|build)\s*[:=]?\s*(\d{3,6})\b/i);
  if (labeled?.[1]) return Number.parseInt(labeled[1], 10);
  return null;
}

export function isSupportedLlamaBuild(build: number): boolean {
  return build >= MIN_LLAMA_BUILD;
}
