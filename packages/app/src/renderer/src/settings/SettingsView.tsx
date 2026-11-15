/**
 * The settings (task 5.7, boards « Réglages · … »): the navigation — back to
 * the conversations, the pages in three groups, the versions at the foot —
 * and the page chosen. A change is kept by the core at once, applied at once
 * (the look, the language), and said on the window (`bonaparte-setting`) to
 * whatever else follows it (the sidebar's grouping).
 */

import { appInfo, engineLlama, settingsAll, settingsSet, type Locale } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { applyAppearance } from '../theme/appearance';
import { AppearancePage } from './Appearance';
import { GeneralPage } from './General';
import { EngineMemoryPage } from './EngineMemory';
import { ModelsPage } from './Models';

export type SettingsPageName = 'general' | 'appearance' | 'engine' | 'models' | 'permissions';

/** Said on the window when a setting changed: `{ key, value }`. */
export const SETTING_CHANGED = 'bonaparte-setting';

const APPEARANCE = new Set(['theme', 'accent', 'textSize', 'listDensity', 'codeFont']);

export type Values = Record<string, unknown>;

export interface PageProps {
  messages: Messages;
  locale: Locale;
  values: Values;
  change(key: string, value: unknown): void;
}

const GROUPS: { group: 'application' | 'engine' | 'agent'; pages: SettingsPageName[] }[] = [
  { group: 'application', pages: ['general', 'appearance'] },
  { group: 'engine', pages: ['engine', 'models'] },
  { group: 'agent', pages: ['permissions'] },
];

export function SettingsView({
  messages,
  locale,
  page,
  onPage,
  onBack,
}: {
  messages: Messages;
  locale: Locale;
  page: SettingsPageName;
  onPage(page: SettingsPageName): void;
  onBack(): void;
}) {
  const words = messages.settings;
  const [values, setValues] = useState<Values | null>(null);
  const [versions, setVersions] = useState<{ app: string; llama: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void bridge.invoke(settingsAll, undefined).then((all) => {
      if (alive) setValues(Object.fromEntries(all.map((entry) => [entry.key, entry.value])));
    });
    void Promise.all([bridge.invoke(appInfo, undefined), bridge.invoke(engineLlama, {}).catch(() => null)]).then(([info, llama]) => {
      if (alive) setVersions({ app: info.version, llama: llama?.current?.build ?? null });
    });
    return () => {
      alive = false;
    };
  }, []);

  const change = (key: string, value: unknown): void => {
    setValues((was) => ({ ...was, [key]: value }));
    void bridge
      .invoke(settingsSet, { key, value })
      .then(() => {
        if (APPEARANCE.has(key)) applyAppearance({ [key]: value });
        window.dispatchEvent(new CustomEvent(SETTING_CHANGED, { detail: { key, value } }));
      })
      .catch(() => undefined);
  };

  const props: PageProps | null = values ? { messages, locale, values, change } : null;
  return (
    <div className="settings">
      <nav className="settings__nav" aria-label={words.nav}>
        <a
          href="#conversations"
          className="settings__back"
          onClick={(event) => {
            event.preventDefault();
            onBack();
          }}
        >
          {words.back}
        </a>
        <h2 className="settings__title">{words.nav}</h2>
        {GROUPS.map(({ group, pages }) => (
          <div key={group} className="settings__group">
            <span className="settings__group-title">{words.groups[group]}</span>
            {pages.map((one) => (
              <a
                key={one}
                href={`#settings-${one}`}
                className="settings__entry"
                {...(one === page ? { 'aria-current': 'page' as const } : {})}
                onClick={(event) => {
                  event.preventDefault();
                  onPage(one);
                }}
              >
                {words.pages[one]}
              </a>
            ))}
          </div>
        ))}
        {versions ? <span className="settings__versions">{words.versions(versions.app, versions.llama ?? words.llamaMissing)}</span> : null}
      </nav>
      <div className={`settings__page${page === 'engine' ? ' settings__page--wide' : ''}`}>
        <h1 className="settings__heading">{words.pages[page]}</h1>
        {props && page === 'general' ? <GeneralPage {...props} /> : null}
        {props && page === 'appearance' ? <AppearancePage {...props} /> : null}
        {props && page === 'models' ? <ModelsPage {...props} /> : null}
        {props && page === 'engine' ? <EngineMemoryPage {...props} onPage={onPage} /> : null}
      </div>
    </div>
  );
}
