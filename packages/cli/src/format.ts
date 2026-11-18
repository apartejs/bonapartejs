/**
 * The doctor's report on a terminal: one line per check, its mark first (✓ ready, ! a warning, ✗ what
 * blocks), then the verdict. Pure, tested without a terminal; the marks are coloured only on one.
 */

import type { DoctorCheck, DoctorReport, DoctorStatus } from '@aparte/bonaparte-core';
import type { CliMessages } from './messages/types.js';

const MARK: Record<DoctorStatus, string> = { ok: '✓', warn: '!', fail: '✗' };
const COLOUR: Record<DoctorStatus, string> = { ok: '\u001b[32m', warn: '\u001b[33m', fail: '\u001b[31m' };
const RESET = '\u001b[0m';

/** A size in binary units, one decimal when it is small (« 1.5 GB », « 500 GB »). */
function size(bytes: number, words: CliMessages): string {
  const gib = bytes / 1024 ** 3;
  if (gib >= 1) return `${gib >= 10 ? Math.round(gib) : Math.round(gib * 10) / 10} ${words.units.gb}`;
  return `${Math.round(bytes / 1024 ** 2)} ${words.units.mb}`;
}

function line(check: DoctorCheck, words: CliMessages): string {
  const say = words.doctor;
  switch (check.id) {
    case 'node':
      return check.status === 'ok' ? say.node(check.version, check.min) : say.nodeTooOld(check.version, check.min);
    case 'llama': {
      if (!check.found || !check.command || !check.source) return say.llamaMissing;
      if (check.build === null || check.build === undefined) return say.llamaSilent(check.command);
      if (check.tooOld) return say.llamaTooOld(check.command, check.build, check.minBuild ?? 0);
      return check.status === 'warn' ? say.llamaUnknownBuild(check.command, check.build) : say.llama(check.command, check.build, check.source);
    }
    case 'slots':
      if (!check.writable) return say.slotsNotWritable(check.dir);
      if (check.status === 'warn' && check.freeBytes !== null) return say.slotsLowDisk(check.dir, size(check.freeBytes, words));
      return say.slots(check.dir, check.freeBytes === null ? null : size(check.freeBytes, words));
    case 'gpu':
      return check.bytes === null ? say.gpuNone : say.gpu(size(check.bytes, words));
  }
}

export function formatDoctorReport(report: DoctorReport, words: CliMessages, options: { color?: boolean } = {}): string {
  const mark = (status: DoctorStatus): string => (options.color ? `${COLOUR[status]}${MARK[status]}${RESET}` : MARK[status]);
  return [
    `('.') ${words.doctor.title}`,
    '',
    ...report.checks.map((check) => ` ${mark(check.status)} ${line(check, words)}`),
    '',
    report.ok ? words.doctor.allGood : words.doctor.blocking,
  ].join('\n');
}
