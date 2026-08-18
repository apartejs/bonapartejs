import { describe, expect, it } from 'vitest';
import { PermissionEngine, type PlayMode } from './engine.js';

const read = { tool: 'read_file', effect: 'read' as const };
const write = { tool: 'write_file', effect: 'write' as const };
const exec = { tool: 'run_shell', effect: 'execute' as const, command: 'pnpm test' };

function engine(mode: PlayMode): PermissionEngine {
  return new PermissionEngine(mode);
}

describe('PermissionEngine — matrice mode × effet', () => {
  it.each([
    ['lecture', 'allow', 'deny', 'deny'],
    ['repetition', 'allow', 'ask', 'ask'],
    ['plume', 'allow', 'allow', 'ask'],
    ['impro', 'allow', 'allow', 'allow'],
  ] as const)('%s : lire=%s, écrire=%s, exécuter=%s', (mode, r, w, e) => {
    const perm = engine(mode);
    expect(perm.evaluate(read)).toBe(r);
    expect(perm.evaluate(write)).toBe(w);
    expect(perm.evaluate(exec)).toBe(e);
  });

  it('le mode par défaut est Répétition', () => {
    expect(new PermissionEngine().getMode()).toBe('repetition');
  });

  it('setMode change l’arbitrage immédiatement', () => {
    const perm = engine('repetition');
    expect(perm.evaluate(write)).toBe('ask');
    perm.setMode('plume');
    expect(perm.evaluate(write)).toBe('allow');
  });
});

describe('PermissionEngine — règles mémorisées', () => {
  it('une règle transforme un « demander » en « autoriser »', () => {
    const perm = engine('repetition');
    expect(perm.evaluate(write)).toBe('ask');
    perm.remember({ tool: 'write_file' });
    expect(perm.evaluate(write)).toBe('allow');
  });

  it('une règle ne lève JAMAIS un refus du mode', () => {
    const perm = engine('lecture');
    perm.remember({ tool: 'write_file' });
    perm.remember({ tool: 'run_shell', commandPrefix: 'pnpm' });
    expect(perm.evaluate(write)).toBe('deny');
    expect(perm.evaluate(exec)).toBe('deny');
  });

  it('une règle ne vaut que pour son outil', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'write_file' });
    expect(perm.evaluate(exec)).toBe('ask');
  });

  it('règle à préfixe : autorise la commande qui commence par le préfixe', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'run_shell', commandPrefix: 'pnpm test' });
    expect(perm.evaluate(exec)).toBe('allow');
  });

  it('règle à préfixe : une autre commande reste à demander', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'run_shell', commandPrefix: 'pnpm test' });
    expect(
      perm.evaluate({ ...exec, command: 'rm -rf /' }),
    ).toBe('ask');
  });

  it('le préfixe s’applique aux frontières de mot (pas de faux positif)', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'run_shell', commandPrefix: 'pnpm test' });
    expect(perm.evaluate({ ...exec, command: 'pnpm testament-destructif' })).toBe(
      'ask',
    );
  });

  it('une règle sans préfixe autorise toutes les commandes de l’outil', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'run_shell' });
    expect(perm.evaluate({ ...exec, command: 'nimporte quoi' })).toBe('allow');
  });

  it('remember est idempotent', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'write_file' });
    perm.remember({ tool: 'write_file' });
    expect(perm.listRules()).toHaveLength(1);
  });

  it('forget retire la règle et rétablit la demande', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'write_file' });
    perm.forget({ tool: 'write_file' });
    expect(perm.listRules()).toEqual([]);
    expect(perm.evaluate(write)).toBe('ask');
  });

  it('les règles fournies à la construction s’appliquent', () => {
    const perm = new PermissionEngine('repetition', [{ tool: 'write_file' }]);
    expect(perm.evaluate(write)).toBe('allow');
  });

  it('listRules ne laisse pas muter l’état interne', () => {
    const perm = engine('repetition');
    perm.remember({ tool: 'write_file' });
    perm.listRules().push({ tool: 'run_shell' });
    expect(perm.listRules()).toHaveLength(1);
  });
});
