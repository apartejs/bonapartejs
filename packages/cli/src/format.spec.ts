import { harnessT, type DoctorReport } from '@aparte/bonaparte-core';
import { describe, expect, it } from 'vitest';
import { formatDoctorReport } from './format.js';

const okReport: DoctorReport = {
  ok: true,
  checks: [
    { id: 'node', label: 'Version de Node.js', status: 'ok', blocking: false, detail: 'v24.14.0' },
    { id: 'gpu', label: 'Détection GPU', status: 'warn', blocking: false, detail: 'CPU uniquement' },
  ],
};

const failReport: DoctorReport = {
  ok: false,
  checks: [
    {
      id: 'llama-server',
      label: 'Binaire llama-server',
      status: 'fail',
      blocking: true,
      detail: 'introuvable',
    },
  ],
};

describe('formatDoctorReport', () => {
  it('shows one line per check with its symbol', () => {
    const out = formatDoctorReport(okReport, 'fr', { color: false });
    expect(out).toContain('✓ Version de Node.js — v24.14.0');
    expect(out).toContain('! Détection GPU — CPU uniquement');
  });

  it('marks failures with ✗', () => {
    const out = formatDoctorReport(failReport, 'fr', { color: false });
    expect(out).toContain('✗ Binaire llama-server — introuvable');
  });

  it('ends with allGood when everything is fine', () => {
    const out = formatDoctorReport(okReport, 'fr', { color: false });
    expect(out).toContain(harnessT('fr').doctor.allGood);
  });

  it('ends with hasBlockingIssues on a blocking failure', () => {
    const out = formatDoctorReport(failReport, 'en', { color: false });
    expect(out).toContain(harnessT('en').doctor.hasBlockingIssues);
  });

  it('starts with the localized title', () => {
    const out = formatDoctorReport(okReport, 'fr', { color: false });
    expect(out.startsWith(`('.') ${harnessT('fr').doctor.title}`)).toBe(true);
  });

  it('without color, no ANSI sequence', () => {
    const out = formatDoctorReport(okReport, 'fr', { color: false });
    expect(out).not.toMatch(/\[/);
  });

  it('with color, the symbols are colored', () => {
    const out = formatDoctorReport(okReport, 'fr', { color: true });
    expect(out).toMatch(/\[32m✓/);
  });
});
