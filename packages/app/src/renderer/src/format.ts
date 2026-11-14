/**
 * Numbers as the interface writes them. Sizes are binary (1 Go = 1 024³
 * bytes) and written in the units of the language — Mo and Go in French, as
 * Windows does; the decimal mark is the language's.
 */

export interface SizeUnits {
  b: string;
  kb: string;
  mb: string;
  gb: string;
}

export interface NumberStyle {
  locale: string;
  units: SizeUnits;
}

const STEPS = [
  { bytes: 1024 ** 3, unit: 'gb' },
  { bytes: 1024 ** 2, unit: 'mb' },
  { bytes: 1024, unit: 'kb' },
] as const;

export function formatBytes(bytes: number, style: NumberStyle): string {
  const number = new Intl.NumberFormat(style.locale, { maximumFractionDigits: 1 });
  const step = STEPS.find((candidate) => bytes >= candidate.bytes);
  if (!step) return `${Math.round(bytes)} ${style.units.b}`;
  const value = bytes / step.bytes;
  // Below the gigabyte, a tenth is noise: 954 Mo, not 953,7 Mo.
  const shown = step.unit === 'gb' ? number.format(value) : String(Math.round(value));
  return `${shown} ${style.units[step.unit]}`;
}

/** A duration said before it is paid: whole seconds, and never zero. */
export function formatSeconds(seconds: number): string {
  return String(Math.max(1, Math.round(seconds)));
}
