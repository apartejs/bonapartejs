import { describe, expect, it } from 'vitest';
import { resolveSettings, type SettingField } from './resolve.js';

const fields: SettingField[] = [
  {
    key: 'temperature',
    label: 'Température',
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 0.7,
  },
  {
    key: 'nCtx',
    label: 'Taille de contexte',
    type: 'number',
    // Un paramètre de LANCEMENT : il entre au manifest KV, donc il ne se
    // règle pas par conversation.
    scopes: ['global'],
    default: 8192,
  },
];

const byKey = (resolved: ReturnType<typeof resolveSettings>, key: string) =>
  resolved.find((setting) => setting.key === key);

describe('resolveSettings', () => {
  it('sans surcharge, la valeur vient du défaut et le dit', () => {
    const resolved = resolveSettings(fields, {}, 'conversation');
    expect(byKey(resolved, 'temperature')).toMatchObject({
      value: 0.7,
      from: 'default',
      overridden: false,
    });
  });

  it('le global l’emporte sur le défaut', () => {
    const resolved = resolveSettings(fields, { global: { temperature: 0.3 } }, 'global');
    expect(byKey(resolved, 'temperature')).toMatchObject({ value: 0.3, from: 'global' });
  });

  it('la conversation l’emporte sur le global', () => {
    const resolved = resolveSettings(
      fields,
      { global: { temperature: 0.3 }, conversation: { temperature: 0.9 } },
      'conversation',
    );
    expect(byKey(resolved, 'temperature')).toMatchObject({
      value: 0.9,
      from: 'conversation',
      overridden: true,
    });
  });

  it('dit de QUOI la valeur hérite quand elle n’est pas surchargée', () => {
    // C'est ce qui permet à l'UI d'écrire « hérité du réglage global (0,3) »
    // au lieu d'afficher un champ dont on ignore d'où il sort.
    const resolved = resolveSettings(fields, { global: { temperature: 0.3 } }, 'conversation');
    expect(byKey(resolved, 'temperature')).toMatchObject({
      value: 0.3,
      from: 'global',
      overridden: false,
      inheritedFrom: 'global',
    });
  });

  it('n’expose dans une portée que les réglages qui s’y règlent', () => {
    const conversation = resolveSettings(fields, {}, 'conversation');
    expect(conversation.map((s) => s.key)).toEqual(['temperature']);

    const global = resolveSettings(fields, {}, 'global');
    expect(global.map((s) => s.key)).toEqual(['temperature', 'nCtx']);
  });

  it('ignore une surcharge de portée interdite plutôt que de l’appliquer', () => {
    // Une conversation ne peut pas changer nCtx : l'accepter ferait diverger
    // le manifest KV du serveur réellement lancé.
    const resolved = resolveSettings(
      fields,
      { conversation: { nCtx: 32768 } },
      'global',
    );
    expect(byKey(resolved, 'nCtx')?.value).toBe(8192);
  });

  it('remet le défaut quand une surcharge vaut undefined', () => {
    const resolved = resolveSettings(
      fields,
      { global: { temperature: 0.3 }, conversation: { temperature: undefined } },
      'conversation',
    );
    expect(byKey(resolved, 'temperature')).toMatchObject({ value: 0.3, from: 'global' });
  });
});
