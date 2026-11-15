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

/**
 * A wait as the person reads it: to the tenth under ten seconds (« 0,6 s »),
 * to the second under a minute, then in minutes (« 2 min 50 », « 4 min »).
 * Never zero: what is announced is paid.
 */
export function formatDuration(seconds: number, locale: string): string {
  if (seconds < 10) {
    const tenth = Math.max(0.1, Math.round(seconds * 10) / 10);
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(tenth)} s`;
  }
  // Rounded first, then split: 119.7 s is « 2 min », never « 1 min 60 ».
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole} s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${String(rest).padStart(2, '0')}`;
}

/** A count of tokens, its thousands grouped as the language groups them. */
export function formatTokens(tokens: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(Math.round(tokens));
}
