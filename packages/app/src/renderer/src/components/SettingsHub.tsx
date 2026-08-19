import type {
  BackendConfigDto,
  PluginStatusDto,
  ResolvedSettingDto,
} from '@aparte/bonaparte-shared';
import { SettingsForm } from '@aparte/bonaparte-plugin-sdk';
import { useCallback, useEffect, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

type Section = 'general' | 'sampling' | 'launch' | 'plugins';

interface SettingsHubProps {
  engine: BackendConfigDto | undefined;
  onChangeEngine: () => void;
  onToggleTheme: () => void;
  onClose: () => void;
}

/**
 * Hub Réglages — un seul endroit pour tout ce qui est global.
 *
 * Les sections « Échantillonnage » et « Moteur et modèle » sont rendues par le
 * MÊME moteur de formulaire que le panneau de conversation : un réglage est
 * décrit une fois dans le catalogue du harness et apparaît partout où sa
 * portée l'autorise, avec sa provenance affichée.
 */
export function SettingsHub({
  engine,
  onChangeEngine,
  onToggleTheme,
  onClose,
}: SettingsHubProps) {
  const { t, locale, setLocale } = useTranslate();
  const [section, setSection] = useState<Section>('general');
  const [settings, setSettings] = useState<ResolvedSettingDto[]>([]);
  const [plugins, setPlugins] = useState<PluginStatusDto[]>([]);

  const refresh = useCallback(async () => {
    setSettings(await window.bonaparte.getSettings('global'));
    setPlugins(await window.bonaparte.listPlugins());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const change = useCallback(
    async (key: string, value: unknown) => {
      await window.bonaparte.setSetting('global', key, value);
      await refresh();
    },
    [refresh],
  );

  const labels = {
    advanced: t.settings.advanced,
    inherited: t.settings.inherited,
    reset: t.settings.reset,
    kvWarning: t.settings.kvWarning,
  };

  // Les clés d'échantillonnage sont celles réglables aussi par conversation.
  const samplingKeys = new Set(['temperature', 'topP', 'topK', 'minP', 'seed']);
  const sampling = settings.filter((setting) => samplingKeys.has(setting.key));
  const launch = settings.filter((setting) => !samplingKeys.has(setting.key));

  const sections: { id: Section; label: string }[] = [
    { id: 'general', label: t.settings.general },
    { id: 'sampling', label: t.settings.sampling },
    { id: 'launch', label: t.settings.launch },
    { id: 'plugins', label: t.settings.plugins },
  ];

  return (
    <div className="settings-hub">
      <header className="settings-hub-head">
        <h2 className="settings-hub-title">{t.settings.heading}</h2>
        <button type="button" onClick={onClose}>
          {t.settings.close}
        </button>
      </header>

      <div className="settings-hub-body">
        <nav className="settings-nav" aria-label={t.settings.heading}>
          {sections.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`settings-nav-item${section === entry.id ? ' settings-nav-active' : ''}`}
              onClick={() => setSection(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          {section === 'general' && (
            <div className="settings-form">
              <div className="setting-row">
                <span className="setting-label">{t.actions.toggleLocale}</span>
                <select
                  value={locale}
                  onChange={(event) => setLocale(event.target.value as 'fr' | 'en')}
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="setting-row">
                <span className="setting-label">{t.actions.toggleTheme}</span>
                <button type="button" onClick={onToggleTheme}>
                  {t.actions.toggleTheme}
                </button>
              </div>
              <div className="setting-row">
                <span className="setting-label">{t.settings.launch}</span>
                <button type="button" onClick={onChangeEngine}>
                  {engine ? engineLabel(engine) : t.status.notConnected}
                </button>
              </div>
            </div>
          )}

          {section === 'sampling' && (
            <SettingsForm
              settings={sampling}
              scope="global"
              labels={labels}
              onChange={(key, value) => void change(key, value)}
            />
          )}

          {section === 'launch' && (
            <SettingsForm
              settings={launch}
              scope="global"
              labels={labels}
              onChange={(key, value) => void change(key, value)}
            />
          )}

          {section === 'plugins' && (
            <ul className="plugin-list">
              {plugins.length === 0 && <li className="setting-help">{t.settings.noPlugins}</li>}
              {plugins.map((plugin) => (
                <li key={plugin.id} className="plugin-row">
                  <span className="plugin-name">{plugin.name}</span>
                  <span className="plugin-version">{plugin.version}</span>
                  <span
                    className={plugin.error ? 'plugin-state-failed' : 'plugin-state-active'}
                  >
                    {plugin.error ? t.settings.pluginFailed : t.settings.pluginActive}
                  </span>
                  {plugin.description && (
                    <p className="setting-help">{plugin.description}</p>
                  )}
                  {/* Un plugin cassé se montre avec son erreur : le faire
                      disparaître laisserait l'utilisateur sans explication. */}
                  {plugin.error && <p className="setting-warning">{plugin.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function engineLabel(engine: BackendConfigDto): string {
  return engine.mode === 'managed' ? `llama.cpp — ${engine.binPath}` : engine.url;
}
