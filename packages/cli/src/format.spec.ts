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
  it('affiche une ligne par check avec son symbole', () => {
    const out = formatDoctorReport(okReport, 'fr', { color: false });
    expect(out).toContain('✓ Version de Node.js — v24.14.0');
    expect(out).toContain('! Détection GPU — CPU uniquement');
  });

  it('marque les échecs avec ✗', () => {
    const out = formatDoctorReport(failReport, 'fr', { color: false });
    expect(out).toContain('✗ Binaire llama-server — introuvable');
  });

  it('conclut par allGood quand tout va bien', () => {
    const out = formatDoctorReport(okReport, 'fr', { color: false });
    expect(out).toContain(harnessT('fr').doctor.allGood);
  });

  it('conclut par hasBlockingIssues en cas d’échec bloquant', () => {
    const out = formatDoctorReport(failReport, 'en', { color: false });
    expect(out).toContain(harnessT('en').doctor.hasBlockingIssues);
  });

  it('commence par le titre localisé', () => {
    const out = formatDoctorReport(okReport, 'fr', { color: false });
    expect(out.startsWith(`('.') ${harnessT('fr').doctor.title}`)).toBe(true);
  });

  it('sans couleur, aucune séquence ANSI', () => {
    const out = formatDoctorReport(okReport, 'fr', { color: false });
    expect(out).not.toMatch(/\[/);
  });

  it('avec couleur, les symboles sont colorés', () => {
    const out = formatDoctorReport(okReport, 'fr', { color: true });
    expect(out).toMatch(/\[32m✓/);
  });
});
