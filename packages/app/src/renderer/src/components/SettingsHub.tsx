import {
  localize,
  type BackendConfigDto,
  type GpuStatusDto,
  type GrantDto,
  type KvUsageDto,
  type PluginStatusDto,
  type ResolvedSettingDto,
} from '@aparte/bonaparte-shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Kbd,
  KbdGroup,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsForm,
  Switch,
  cn,
} from '@aparte/bonaparte-plugin-sdk/ui';
import { MonitorCog } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';
import { formatBytes } from '../models/format.js';

type Section = 'general' | 'sampling' | 'launch' | 'plugins' | 'permissions';

interface SettingsHubProps {
  engine: BackendConfigDto | undefined;
  onChangeEngine: () => void;
  onToggleTheme: () => void;
  onClose: () => void;
  /** The plugins changed (switched, reloaded): the tooling panel follows. */
  onPluginsChange?: (plugins: PluginStatusDto[]) => void;
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
  onPluginsChange,
}: SettingsHubProps) {
  const { t, locale, setLocale } = useTranslate();
  const [section, setSection] = useState<Section>('general');
  const [settings, setSettings] = useState<ResolvedSettingDto[]>([]);
  const [plugins, setPlugins] = useState<PluginStatusDto[]>([]);
  const [reloading, setReloading] = useState(false);
  const [grants, setGrants] = useState<GrantDto[]>([]);
  const [kv, setKv] = useState<KvUsageDto | null>(null);
  const [freed, setFreed] = useState<number | null>(null);
  const [gpu, setGpu] = useState<GpuStatusDto | null>(null);

  const refresh = useCallback(async () => {
    setSettings(await window.bonaparte.getSettings('global'));
    setPlugins(await window.bonaparte.listPlugins());
    setGrants(await window.bonaparte.listGrants());
    setKv(await window.bonaparte.kvUsage());
    setGpu(await window.bonaparte.gpuStatus());
  }, []);

  const revoke = useCallback(
    async (grant: GrantDto) => {
      await window.bonaparte.revokeGrant(grant);
      setGrants(await window.bonaparte.listGrants());
    },
    [],
  );

  /** Grants grouped by project — "no project" last. */
  const grantGroups = useMemo(() => {
    const groups = new Map<string, { title: string; items: GrantDto[] }>();
    for (const grant of grants) {
      const key = grant.projectId ?? '';
      const title = grant.projectId
        ? (grant.projectName ?? grant.projectId)
        : t.settings.grantNoProject;
      const group = groups.get(key) ?? { title, items: [] };
      group.items.push(grant);
      groups.set(key, group);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0))
      .map(([key, group]) => ({ key, ...group }));
  }, [grants, t.settings.grantNoProject]);

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
  const appKeys = new Set(['closeToTray', 'notifyTurnEnd', 'idleUnload', 'idleUnloadMinutes', 'kvBudgetGb']);
  const appSettings = settings.filter((setting) => appKeys.has(setting.key));
  const launch = settings.filter(
    (setting) =>
      !samplingKeys.has(setting.key) && !appKeys.has(setting.key) && !setting.key.startsWith('plugin:'),
  );
  const pluginSettings = (id: string) =>
    settings.filter((setting) => setting.key.startsWith(`plugin:${id}:`));

  const sections: { id: Section; label: string }[] = [
    { id: 'general', label: t.settings.general },
    { id: 'sampling', label: t.settings.sampling },
    { id: 'launch', label: t.settings.launch },
    { id: 'plugins', label: t.settings.plugins },
    { id: 'permissions', label: t.settings.permissions },
  ];

  return (
    <div className="settings-hub fixed inset-0 z-40 flex flex-col bg-background">
      <header className="settings-hub-head flex items-center justify-between border-b px-[18px] py-3.5">
        <h2 className="settings-hub-title font-serif text-[19px] font-normal">{t.settings.heading}</h2>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t.settings.close}
        </Button>
      </header>

      <div className="settings-hub-body flex min-h-0 flex-1">
        <nav
          className="settings-nav flex w-[200px] shrink-0 flex-col gap-0.5 border-e px-2 py-3"
          aria-label={t.settings.heading}
        >
          {sections.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              variant="ghost"
              className={cn(
                'settings-nav-item justify-start font-normal',
                section === entry.id && 'settings-nav-active bg-secondary ring-1 ring-primary',
              )}
              aria-current={section === entry.id ? 'page' : undefined}
              onClick={() => setSection(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </nav>

        <div className="settings-panel min-w-0 flex-1 overflow-y-auto px-[22px] py-[18px]">
          {section === 'general' && (
            <div className="settings-form flex max-w-[560px] flex-col gap-5">
              <div className="setting-row flex flex-col gap-1.5">
                <Label htmlFor="setting-language">{t.settings.language}</Label>
                <Select value={locale} onValueChange={(value) => setLocale(value as 'fr' | 'en')}>
                  <SelectTrigger id="setting-language" size="sm" className="w-60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="setting-row flex flex-col gap-1.5">
                <span className="setting-label text-sm font-medium">{t.actions.toggleTheme}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={onToggleTheme}
                >
                  {t.actions.toggleTheme}
                </Button>
              </div>
              <div className="setting-row flex flex-col gap-1.5">
                <span className="setting-label text-sm font-medium">{t.settings.launch}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={onChangeEngine}
                >
                  {engine ? engineLabel(engine) : t.status.notConnected}
                </Button>
              </div>
              {appSettings.length > 0 && (
                <SettingsForm
                  settings={appSettings}
                  scope="global"
                  labels={labels}
                  locale={locale}
                  onChange={(key, value) => void change(key, value)}
                />
              )}
              {/* Every shortcut, in one place: the ones in the fingers already
                  (VS Code's), and the tooling's. */}
              <div className="shortcut-list flex flex-col gap-1.5 border-t pt-4">
                <span className="setting-label text-sm font-medium">{t.settings.shortcuts}</span>
                <ul className="flex flex-col gap-1">
                  {(
                    [
                      [t.settings.shortcutNew, ['Ctrl', 'N']],
                      [t.settings.shortcutSearch, ['Ctrl', 'K']],
                      [t.settings.shortcutComposer, ['Ctrl', 'L']],
                      [t.settings.shortcutSidebar, ['Ctrl', 'B']],
                      [t.settings.shortcutPanel, ['Ctrl', 'Alt', 'B']],
                      [t.settings.shortcutTerminal, ['Ctrl', '`']],
                      [t.settings.shortcutBrowser, ['Ctrl', 'T']],
                      [t.settings.shortcutSettings, ['Ctrl', ',']],
                    ] as const
                  ).map(([label, keys]) => (
                    <li key={label} className="flex items-center justify-between gap-3 text-[12.5px]">
                      <span className="text-muted-foreground">{label}</span>
                      <KbdGroup>
                        {keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </KbdGroup>
                    </li>
                  ))}
                </ul>
              </div>
              {/* The budget's other half: what the saved contexts take now,
                  and a way to take it back — they are a cache. */}
              {kv && (
                <div className="kv-usage flex flex-col gap-2 border-t pt-4">
                  <p className="text-[12.5px] leading-snug text-muted-foreground">
                    {t.settings.kvUsage
                      .replace('{total}', formatBytes(kv.totalBytes, t.units))
                      .replace('{budget}', formatBytes(kv.budgetBytes, t.units))
                      .replace('{conversations}', String(kv.conversations))
                      .replace('{seeds}', String(kv.seeds))}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    disabled={kv.totalBytes === 0}
                    onClick={() => {
                      void window.bonaparte.freeKv().then(async (count) => {
                        setFreed(count);
                        setKv(await window.bonaparte.kvUsage());
                      });
                    }}
                  >
                    {t.settings.kvFree}
                  </Button>
                  {freed !== null && (
                    <p className="kv-freed text-[12px] text-muted-foreground" role="status">
                      {t.settings.kvFreed.replace('{count}', String(freed))}
                    </p>
                  )}
                </div>
              )}
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
            <div className="flex flex-col gap-4">
              {gpu && gpu.active !== gpu.wanted && <GpuRestartNotice gpu={gpu} />}
              <SettingsForm
                settings={launch}
                scope="global"
                labels={labels}
                locale={locale}
                onChange={(key, value) => void change(key, value)}
              />
            </div>
          )}

          {section === 'permissions' && (
            <div className="grants flex max-w-[560px] flex-col gap-4">
              <p className="setting-help text-[12px] leading-snug text-muted-foreground">
                {t.settings.permissionsHint}
              </p>
              {grantGroups.length === 0 ? (
                <p className="grants-empty text-[12.5px] text-muted-foreground">{t.settings.permissionsEmpty}</p>
              ) : (
                grantGroups.map((group) => (
                  <section key={group.key} className="grant-group flex flex-col gap-1">
                    <h3 className="grant-group-title text-[12px] font-semibold text-muted-foreground">
                      {group.title}
                    </h3>
                    <ul className="flex flex-col">
                      {group.items.map((grant) => (
                        <li
                          key={`${grant.tool}|${grant.commandPrefix ?? ''}|${grant.exactCommand ?? ''}`}
                          className="grant-row flex items-center gap-3 border-b py-2 last:border-b-0"
                        >
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-[13px]">
                              {grant.commandPrefix
                                ? t.settings.grantBinary.replace('{binary}', grant.commandPrefix)
                                : grant.exactCommand
                                  ? t.settings.grantCommand
                                  : grant.tool}
                            </span>
                            <span className="truncate font-mono text-[11px] text-muted-foreground">
                              {grant.exactCommand ?? (grant.commandPrefix ? grant.tool : t.settings.grantTool)}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => void revoke(grant)}
                          >
                            {t.settings.revoke}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>
          )}

          {section === 'plugins' && (
            <>
              {/* Hot reload rather than restart: a plugin's Node half is
                  loaded once at startup, and restarting the app reloads the
                  model into VRAM. The host is reversible for this reason. */}
              <div className="plugin-actions flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={reloading}
                  onClick={() => {
                    setReloading(true);
                    void window.bonaparte
                      .reloadPlugins()
                      .then((next) => {
                        setPlugins(next);
                        onPluginsChange?.(next);
                      })
                      .finally(() => setReloading(false));
                  }}
                >
                  {reloading ? t.settings.pluginReloading : t.settings.pluginReload}
                </Button>
                <span className="setting-help text-[11.5px] text-muted-foreground">
                  {t.settings.pluginReloadHint}
                </span>
              </div>
              {plugins
                .filter((plugin) => plugin.active && pluginSettings(plugin.id).length > 0)
                .map((plugin) => (
                  <section key={plugin.id} className="plugin-settings mt-[18px] border-t pt-3.5">
                    <h3 className="plugin-settings-title mb-2.5 text-[13px] font-semibold">
                      {localize(plugin.name, locale)}
                    </h3>
                    <SettingsForm
                      settings={pluginSettings(plugin.id)}
                      scope="global"
                      labels={labels}
                      locale={locale}
                      onChange={(key, value) => void change(key, value)}
                    />
                  </section>
                ))}
              <ul className="plugin-list mt-[18px] flex max-w-[560px] flex-col gap-3">
                {plugins.length === 0 && (
                  <li className="setting-help text-[11.5px] text-muted-foreground">
                    {t.settings.noPlugins}
                  </li>
                )}
                {plugins.map((plugin) => (
                  <li key={plugin.id} className="plugin-row flex flex-col gap-1 border-b pb-3">
                    <div className="flex items-baseline gap-2">
                      <span className="plugin-name text-[13.5px]">{localize(plugin.name, locale)}</span>
                      <span className="plugin-version ms-auto font-mono text-[11px] text-muted-foreground">
                        {plugin.version}
                      </span>
                      <Badge
                        variant={plugin.error ? 'destructive' : 'secondary'}
                        className={cn(
                          'font-mono text-[11px] font-normal',
                          plugin.error
                            ? 'plugin-state-failed'
                            : !plugin.enabled
                              ? 'plugin-state-off'
                              : 'plugin-state-active text-emerald-700 dark:text-emerald-300',
                        )}
                      >
                        {plugin.error
                          ? t.settings.pluginFailed
                          : !plugin.enabled
                            ? t.settings.pluginOff
                            : t.settings.pluginActive}
                      </Badge>
                      {/* On or off, live: the host tears a plugin down whole. */}
                      <Switch
                        className="plugin-switch"
                        checked={plugin.enabled}
                        aria-label={t.settings.pluginSwitch.replace('{name}', () => localize(plugin.name, locale))}
                        onCheckedChange={(checked) => {
                          void window.bonaparte.setPluginEnabled(plugin.id, checked).then(async (next) => {
                            setPlugins(next);
                            onPluginsChange?.(next);
                            setSettings(await window.bonaparte.getSettings('global'));
                            // "Auto" follows the Browser plugin: its switch can call for a restart.
                            setGpu(await window.bonaparte.gpuStatus());
                          });
                        }}
                      />
                    </div>
                    {plugin.description && (
                      <p className="setting-help text-[11.5px] leading-snug text-muted-foreground">
                        {localize(plugin.description, locale)}
                      </p>
                    )}
                    {/* A broken plugin shows itself along with its error:
                        making it disappear would leave the user without an
                        explanation. */}
                    {plugin.error && (
                      <p className="setting-warning text-[11.5px] leading-snug text-destructive">
                        {plugin.error}
                      </p>
                    )}
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

/**
 * The interface's GPU mode is fixed when the app starts (D-23): a changed
 * setting waits for a restart, and the restart has a price — the model
 * reloads. Said before it is paid, with the figure when one was measured.
 */
function GpuRestartNotice({ gpu }: { gpu: GpuStatusDto }) {
  const { t } = useTranslate();
  const [restarting, setRestarting] = useState(false);
  const cost = !gpu.modelLoaded
    ? t.settings.gpuRestartFree
    : gpu.reloadSeconds !== undefined
      ? t.settings.gpuRestartCost.replace('{seconds}', () => String(Math.max(1, gpu.reloadSeconds ?? 1)))
      : t.settings.gpuRestartCostUnknown;
  return (
    <Alert role="status" className="gpu-restart max-w-[560px]">
      <MonitorCog aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          {t.settings.gpuRestart} {cost}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={restarting}
          onClick={() => {
            setRestarting(true);
            void window.bonaparte.relaunch().finally(() => setRestarting(false));
          }}
        >
          {t.settings.restartNow}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
