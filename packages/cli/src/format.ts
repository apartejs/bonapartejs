/**
 * Terminal rendering of the doctor report. Pure (string → string), tested without a TTY.
 */

import {
  harnessT,
  type DoctorReport,
  type DoctorStatus,
} from '@aparte/bonaparte-core';
import type { BonaparteLocale } from '@aparte/bonaparte-shared';

export interface FormatOptions {
  color?: boolean;
}

const SYMBOLS: Record<DoctorStatus, string> = {
  ok: '✓',
  warn: '!',
  fail: '✗',
};

const ANSI: Record<DoctorStatus, string> = {
  ok: '\u001b[32m',
  warn: '\u001b[33m',
  fail: '\u001b[31m',
};

const RESET = '\u001b[0m';

export function formatDoctorReport(
  report: DoctorReport,
  locale: BonaparteLocale,
  options: FormatOptions = {},
): string {
  const t = harnessT(locale);
  const color = options.color ?? false;

  const symbol = (status: DoctorStatus): string =>
    color ? `${ANSI[status]}${SYMBOLS[status]}${RESET}` : SYMBOLS[status];

  const lines = [`('.') ${t.doctor.title}`, ''];
  for (const check of report.checks) {
    const detail = check.detail ? ` — ${check.detail}` : '';
    lines.push(` ${symbol(check.status)} ${check.label}${detail}`);
  }
  lines.push('', report.ok ? t.doctor.allGood : t.doctor.hasBlockingIssues);

  return lines.join('\n');
}
