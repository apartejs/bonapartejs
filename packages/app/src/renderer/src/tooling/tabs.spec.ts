import type { PluginStatusDto } from '@aparte/bonaparte-shared';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_TABS,
  activateTab,
  closeTab,
  listViews,
  openTab,
  pruneTabs,
  readTabs,
  writeTabs,
  type ToolingTabsState,
  type ToolingViewDescriptor,
} from './tabs.js';

describe('listViews', () => {
  const browser: PluginStatusDto = {
    id: 'browser',
    name: { en: 'Tooled browser', fr: 'Navigateur outillé' },
    version: '0.1.0',
    enabled: true,
    active: true,
    views: [{ id: 'page', title: { en: 'Browser', fr: 'Navigateur' }, multiple: true, order: 40 }],
    toolNames: [],
  };

  it('localises the titles of the views the active plugins declare', () => {
    // A tab title is a UI string: it follows the locale like every other
    // label, instead of showing whatever language the manifest was written in.
    expect(listViews([browser], 'fr').map((view) => view.title)).toEqual(['Navigateur']);
    expect(listViews([browser], 'en').map((view) => view.title)).toEqual(['Browser']);
  });

  it('ignores inactive plugins', () => {
    expect(listViews([{ ...browser, active: false }], 'en')).toEqual([]);
  });
});

const terminal: ToolingViewDescriptor = {
  pluginId: 'terminal',
  viewId: 'shell',
  title: 'Terminal',
  multiple: true,
  order: 30,
};

const settings: ToolingViewDescriptor = {
  pluginId: 'conversation-settings',
  viewId: 'settings',
  title: 'Conversation',
  multiple: false,
  order: 10,
};

/** localStorage de test — le vrai peut lever (mode privé, quota). */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    raw: data,
  };
}

describe('onglets du panneau d’outillage', () => {
  it('ouvre un onglet et l’active', () => {
    const state = openTab(EMPTY_TABS, terminal);

    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.pluginId).toBe('terminal');
    expect(state.activeId).toBe(state.tabs[0]?.instanceId);
  });

  it('ouvre PLUSIEURS instances du même type, avec des identités distinctes', () => {
    // C'est la demande : « tu peux en ouvrir autant que tu veux ». Deux
    // terminaux sont deux shells, donc deux instances, donc deux ids.
    const state = openTab(openTab(EMPTY_TABS, terminal), terminal);

    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0]?.instanceId).not.toBe(state.tabs[1]?.instanceId);
    expect(state.activeId).toBe(state.tabs[1]?.instanceId);
  });

  it('ne réutilise JAMAIS un identifiant, même après fermeture', () => {
    // Un id réutilisé retomberait sur la session que la moitié Node n'a
    // peut-être pas encore libérée : l'onglet neuf hériterait de l'ancien flux.
    const first = openTab(EMPTY_TABS, terminal);
    const gone = closeTab(first, first.tabs[0]?.instanceId as string);
    const second = openTab(gone, terminal);

    expect(second.tabs[0]?.instanceId).not.toBe(first.tabs[0]?.instanceId);
  });

  it('un type à instance unique se contente d’être activé s’il est déjà là', () => {
    const opened = openTab(openTab(EMPTY_TABS, settings), terminal);
    const again = openTab(opened, settings);

    expect(again.tabs).toHaveLength(2);
    expect(again.activeId).toBe(opened.tabs[0]?.instanceId);
  });

  it('en fermant l’onglet actif, active son voisin de droite', () => {
    const state = openTab(openTab(openTab(EMPTY_TABS, terminal), terminal), terminal);
    const middle = state.tabs[1]?.instanceId as string;
    const closed = closeTab(activateTab(state, middle), middle);

    expect(closed.tabs).toHaveLength(2);
    expect(closed.activeId).toBe(state.tabs[2]?.instanceId);
  });

  it('en fermant le dernier onglet, retombe sur celui de gauche', () => {
    const state = openTab(openTab(EMPTY_TABS, terminal), terminal);
    const last = state.tabs[1]?.instanceId as string;

    expect(closeTab(state, last).activeId).toBe(state.tabs[0]?.instanceId);
  });

  it('en fermant un onglet inactif, ne change pas l’onglet actif', () => {
    const state = openTab(openTab(EMPTY_TABS, terminal), terminal);
    const closed = closeTab(state, state.tabs[0]?.instanceId as string);

    expect(closed.activeId).toBe(state.activeId);
  });

  it('le dernier onglet fermé laisse le panneau vide — mais garde le compteur', () => {
    // Vider le panneau ne remet PAS le compteur à zéro : sinon le prochain
    // onglet reprendrait l'identifiant de celui qu'on vient de fermer.
    const state = openTab(EMPTY_TABS, terminal);
    const closed = closeTab(state, state.tabs[0]?.instanceId as string);

    expect(closed.tabs).toEqual([]);
    expect(closed.activeId).toBeNull();
    expect(closed.seq).toBe(state.seq);
  });

  it('écarte les onglets dont la vue a disparu (plugin désactivé)', () => {
    // Un plugin qu'on désactive laisse des onglets orphelins en mémoire :
    // sans élagage, le panneau afficherait un onglet impossible à charger.
    const state = openTab(openTab(EMPTY_TABS, terminal), settings);
    const pruned = pruneTabs(state, [settings]);

    expect(pruned.tabs.map((tab) => tab.pluginId)).toEqual(['conversation-settings']);
    expect(pruned.activeId).toBe(state.tabs[1]?.instanceId);
  });

  it('l’élagage réactive un survivant quand l’actif a disparu', () => {
    const state = openTab(openTab(EMPTY_TABS, settings), terminal);
    const pruned = pruneTabs(state, [settings]);

    expect(pruned.activeId).toBe(state.tabs[0]?.instanceId);
  });

  it('l’élagage ne recrée pas d’objet quand rien ne change', () => {
    // L'élagage tourne à chaque rendu : rendre un nouvel objet relancerait
    // l'écriture et les effets en boucle.
    const state = openTab(EMPTY_TABS, terminal);

    expect(pruneTabs(state, [terminal, settings])).toBe(state);
  });
});

describe('persistance par conversation', () => {
  it('range les onglets SOUS la conversation, pas globalement', () => {
    // Ce que Paul a demandé : « cette vue à droite est liée à une
    // conversation ». Deux conversations, deux jeux d'onglets.
    const storage = fakeStorage();
    const one = openTab(EMPTY_TABS, terminal);
    writeTabs(storage, 'conv-a', one);

    expect(readTabs(storage, 'conv-a')).toEqual(one);
    expect(readTabs(storage, 'conv-b')).toEqual(EMPTY_TABS);
  });

  it('sans conversation ouverte, ne persiste rien', () => {
    const storage = fakeStorage();
    writeTabs(storage, null, openTab(EMPTY_TABS, terminal));

    expect(storage.raw.size).toBe(0);
    expect(readTabs(storage, null)).toEqual(EMPTY_TABS);
  });

  it('un contenu illisible rend un panneau vide au lieu de lever', () => {
    const storage = fakeStorage({ 'bonaparte.tooling.conv-a': '{oops' });

    expect(readTabs(storage, 'conv-a')).toEqual(EMPTY_TABS);
  });

  it('un contenu de la bonne forme mais du mauvais type est écarté', () => {
    const storage = fakeStorage({
      'bonaparte.tooling.conv-a': '{"tabs":[{"pluginId":42}],"activeId":null,"seq":0}',
    });

    expect(readTabs(storage, 'conv-a')).toEqual(EMPTY_TABS);
  });

  it('survit à un stockage qui lève (mode privé, quota)', () => {
    const hostile = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      removeItem: () => {},
    };

    expect(readTabs(hostile, 'conv-a')).toEqual(EMPTY_TABS);
    expect(() => writeTabs(hostile, 'conv-a', EMPTY_TABS as ToolingTabsState)).not.toThrow();
  });
});
