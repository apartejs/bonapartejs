/**
 * A plugin made in a conversation, in its thread (task 11.4, board « Créer un plugin dans la conversation »): the
 * lines of the tools that make it, and under `extension_define` its card — its name and version, « Il ajoute »,
 * « Il pourra » (its effects, said before anything runs), « Installer », « Essayer dans cette conversation »,
 * « Voir le code ». Nothing runs before a click. Drawn with the kit's classes in aparté's details slot.
 */

import type { AparteConfig, AparteToolCallSegment } from '@aparte/core';
import { aparteGlobalConfig } from '@aparte/core';
import { extensionsCode, extensionsInstall, extensionsTry, localize, type Locale, type PluginManifest } from '@aparte/bonaparte-shared';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';

const TOOLS = ['harness_inspect', 'extension_define', 'extension_run', 'extension_stop', 'extension_undefine'] as const;
const EFFECT_STYLE = { read: 'aparte-badge--neutral', write: 'aparte-badge--warning', execute: 'aparte-badge--danger', network: 'aparte-badge--info' } as const;

interface Made {
  conversationId: string;
  id: string;
  rev: number;
  manifest: PluginManifest;
}

const madeOf = (segment: AparteToolCallSegment): Made | null => {
  const found = (segment.structuredResult as { extension?: Made } | undefined)?.extension;
  return found && typeof found.id === 'string' && typeof found.conversationId === 'string' ? found : null;
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** The card of a plugin made here. */
function cardOf(made: Made, messages: Messages, locale: Locale): HTMLElement {
  const words = messages.plugins.card;
  const card = element('section', 'aparte-card extension-card');
  card.dataset['extension'] = made.id;
  card.setAttribute('aria-label', localize(made.manifest.name, locale));

  const head = element('div', 'extension-card__head');
  head.append(element('strong', 'extension-card__name', localize(made.manifest.name, locale)), element('span', 'extension-card__meta', made.manifest.version));
  card.append(head, element('p', 'extension-card__meta', words.made));

  const columns = element('div', 'extension-card__columns');
  const adds = element('div', 'extension-card__column');
  adds.append(element('h4', 'extension-card__title', words.adds));
  const addList = element('ul', 'extension-card__list');
  const added = [
    ...made.manifest.contributes.commands.map((command) => words.command(command.name)),
    ...made.manifest.contributes.tools.map((tool) => words.tool(tool.name)),
    ...made.manifest.contributes.panes.map((pane) => words.pane(localize(pane.title, locale))),
  ];
  for (const line of added.length > 0 ? added : [words.nothing]) addList.append(element('li', '', line));
  adds.append(addList);
  const may = element('div', 'extension-card__column');
  may.append(element('h4', 'extension-card__title', words.may));
  const mayList = element('ul', 'extension-card__list');
  if (made.manifest.effects.length === 0) mayList.append(element('li', '', words.nothing));
  for (const effect of made.manifest.effects) {
    const line = element('li', 'extension-card__effect');
    line.append(element('span', `aparte-badge ${EFFECT_STYLE[effect.effect]} aparte-badge--soft aparte-badge--sm`, messages.plugins.effects[effect.effect]), element('span', '', localize(effect.what, locale)));
    mayList.append(line);
  }
  may.append(mayList);
  columns.append(adds, may);
  card.append(columns);

  const status = element('p', 'extension-card__status');
  status.setAttribute('role', 'status');
  const code = element('pre', 'extension-card__code');
  code.hidden = true;
  const actions = element('div', 'extension-card__actions');
  const button = (label: string, kind: string, run: (self: HTMLButtonElement) => Promise<void>): HTMLButtonElement => {
    const self = element('button', `aparte-btn aparte-btn--sm ${kind}`, label);
    self.type = 'button';
    self.addEventListener('click', () => {
      self.disabled = true;
      void run(self)
        .catch((error: unknown) => {
          status.textContent = words.failed(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          self.disabled = false;
        });
    });
    return self;
  };
  const ref = { conversationId: made.conversationId, id: made.id };
  actions.append(
    button(words.install, 'aparte-btn--primary aparte-btn--solid', async () => {
      await bridge.invoke(extensionsInstall, ref);
      status.textContent = words.installed;
    }),
    button(words.try, 'aparte-btn--outline', async () => {
      await bridge.invoke(extensionsTry, ref);
      status.textContent = words.trying;
    }),
    button(words.code, 'aparte-btn--outline', async (self) => {
      if (!code.hidden) {
        code.hidden = true;
        self.textContent = words.code;
        return;
      }
      const read = await bridge.invoke(extensionsCode, ref);
      // Evidence, never markup: its text only.
      code.textContent = read?.code ?? '';
      code.hidden = false;
      self.textContent = words.hideCode;
    }),
  );
  card.append(actions, status, code, element('p', 'extension-card__meta', words.kept));
  return card;
}

/** Gives the tools that make a plugin their lines, and `extension_define` its card; the function returned takes them back. */
export function registerExtensionCard(messages: Messages, locale: Locale, config: AparteConfig = aparteGlobalConfig): () => void {
  for (const name of TOOLS) {
    config.registerToolDisplay(name, {
      label: messages.plugins.card.lines[name],
      icon: 'bot',
      // The card is the point of the call: shown open, as the board draws it.
      ...(name === 'extension_define' ? { open: true } : {}),
      summary: (segment: AparteToolCallSegment) => {
        const input = segment.toolCall?.input as { id?: unknown; manifest?: { id?: unknown } } | undefined;
        const id = typeof input?.id === 'string' ? input.id : typeof input?.manifest?.id === 'string' ? input.manifest.id : '';
        return id;
      },
      details:
        name === 'extension_define'
          ? (segment: AparteToolCallSegment, held?: HTMLElement) => {
              if (segment.status !== 'resolved' || typeof document === 'undefined') return '';
              const made = madeOf(segment);
              if (!made) return '';
              if (held?.dataset['extension'] === made.id) return held;
              return cardOf(made, messages, locale);
            }
          : false,
    });
  }
  return () => {
    for (const name of TOOLS) config.unregisterToolDisplay(name);
  };
}
