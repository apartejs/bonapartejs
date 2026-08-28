import {
  localize,
  type BackendConfigDto,
  type PluginStatusDto,
  type ResolvedSettingDto,
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
 * Settings hub — a single place for everything global.
 *
 * The "Sampling" and "Engine and model" sections are rendered by the SAME
 * form engine as the conversation panel: a setting is described once in the
 * harness's catalog and appears everywhere its scope allows, with its origin
 * displayed.
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
  const [reloading, setReloading] = useState(false);

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

  // Sampling keys are the ones also adjustable per conversation.
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
        <button
          type="button"
          className="aparte-btn aparte-btn--neutral aparte-btn--ghost"
          onClick={onClose}
        >
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
                <span className="setting-label">{t.settings.language}</span>
                <select
                  className="aparte-field aparte-field--sm"
                  value={locale}
                  onChange={(event) => setLocale(event.target.value as 'fr' | 'en')}
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="setting-row">
                <span className="setting-label">{t.actions.toggleTheme}</span>
                <button
                  type="button"
                  className="aparte-btn aparte-btn--neutral aparte-btn--soft"
                  onClick={onToggleTheme}
                >
                  {t.actions.toggleTheme}
                </button>
              </div>
              <div className="setting-row">
                <span className="setting-label">{t.settings.launch}</span>
                <button
                  type="button"
                  className="aparte-btn aparte-btn--neutral aparte-btn--soft"
                  onClick={onChangeEngine}
                >
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
              locale={locale}
              onChange={(key, value) => void change(key, value)}
            />
          )}

          {section === 'launch' && (
            <SettingsForm
              settings={launch}
              scope="global"
              labels={labels}
              locale={locale}
              onChange={(key, value) => void change(key, value)}
            />
          )}

          {section === 'plugins' && (
            <>
              {/* Hot reload rather than restart: a plugin's Node half is
                  loaded once at startup, and restarting the app reloads the
                  model into VRAM. The host is reversible for this reason. */}
              <div className="plugin-actions">
                <button
                  type="button"
                  className="aparte-btn aparte-btn--secondary aparte-btn--soft aparte-btn--sm"
                  disabled={reloading}
                  onClick={() => {
                    setReloading(true);
                    void window.bonaparte
                      .reloadPlugins()
                      .then(setPlugins)
                      .finally(() => setReloading(false));
                  }}
                >
                  {reloading ? t.settings.pluginReloading : t.settings.pluginReload}
                </button>
                <span className="setting-help">{t.settings.pluginReloadHint}</span>
              </div>
              <ul className="plugin-list">
              {plugins.length === 0 && <li className="setting-help">{t.settings.noPlugins}</li>}
              {plugins.map((plugin) => (
                <li key={plugin.id} className="plugin-row">
                  <span className="plugin-name">{localize(plugin.name, locale)}</span>
                  <span className="plugin-version">{plugin.version}</span>
                  <span
                    className={
                      plugin.error
                        ? 'plugin-state-failed aparte-badge aparte-badge--danger aparte-badge--soft aparte-badge--sm'
                        : 'plugin-state-active aparte-badge aparte-badge--success aparte-badge--soft aparte-badge--sm'
                    }
                  >
                    {plugin.error ? t.settings.pluginFailed : t.settings.pluginActive}
                  </span>
                  {plugin.description && (
                    <p className="setting-help">{localize(plugin.description, locale)}</p>
                  )}
                  {/* A broken plugin shows itself along with its error:
                      making it disappear would leave the user without an
                      explanation. */}
                  {plugin.error && <p className="setting-warning">{plugin.error}</p>}
                </li>
              ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function engineLabel(engine: BackendConfigDto): string {
  return engine.mode === 'managed' ? `llama.cpp — ${engine.binPath}` : engine.url;
}
