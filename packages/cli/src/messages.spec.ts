import { describe, expect, it } from 'vitest';
import { CLI_MESSAGES, helpText, unknownCommand } from './messages.js';

// The CLI's own words — help, errors — are user-facing, so they follow the
// UI rule: both locales, picked by the detected locale.

describe('CLI messages', () => {
  it('exist in both locales with the same keys', () => {
    expect(Object.keys(CLI_MESSAGES.fr).sort()).toEqual(Object.keys(CLI_MESSAGES.en).sort());
  });

  it('renders the help in the requested locale, with the version', () => {
    expect(helpText('en', '0.1.0')).toContain('bonaparte v0.1.0');
    expect(helpText('en', '0.1.0')).toMatch(/Check the machine/);
    expect(helpText('fr', '0.1.0')).toMatch(/Vérifie/);
  });

  it('lists every command in the help', () => {
    for (const locale of ['fr', 'en'] as const) {
      const help = helpText(locale, '0.1.0');
      expect(help).toContain('bonaparte doctor');
      expect(help).toContain('--version');
      expect(help).toContain('--help');
    }
  });

  it('names the unknown command', () => {
    expect(unknownCommand('en', 'frobnicate')).toContain('frobnicate');
    expect(unknownCommand('fr', 'frobnicate')).toMatch(/inconnue/);
  });
});
