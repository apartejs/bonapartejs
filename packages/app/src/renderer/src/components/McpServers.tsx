import type { McpOverviewDto, McpServerDto } from '@aparte/bonaparte-shared';
import { Badge, Button, Input, Switch, cn } from '@aparte/bonaparte-plugin-sdk/ui';
import { FileJson, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslate } from '../i18n/LocaleProvider.js';

/**
 * The hub's MCP section (P4.2): the servers the user declared, each with
 * its state, its tools or its error, a switch and a way out; a form to add
 * one from a command line or a URL; and the file itself, for what the form
 * does not cover (environment, headers) — the snippet a server documents
 * pastes there as is. Nothing is imposed (D-69): no server is added by
 * bonaparte, and any can be switched off.
 */
export function McpServers() {
  const { t } = useTranslate();
  const [overview, setOverview] = useState<McpOverviewDto | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void window.bonaparte.listMcpServers().then(setOverview);
  }, []);

  const run = useCallback(async (id: string, action: () => Promise<McpOverviewDto>) => {
    setBusy(id);
    try {
      setOverview(await action());
    } finally {
      setBusy(null);
    }
  }, []);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setAdding(true);
    setFormError(null);
    try {
      const outcome = await window.bonaparte.addMcpServer(name, target);
      if ('error' in outcome) {
        setFormError(t.settings.mcpFormErrors[outcome.error]);
        return;
      }
      setOverview(outcome);
      setName('');
      setTarget('');
    } finally {
      setAdding(false);
    }
  };

  const servers = overview?.servers ?? [];
  const errors = overview?.errors ?? [];

  return (
    <div className="mcp flex max-w-[600px] flex-col gap-4">
      <p className="setting-help text-[12px] leading-snug text-muted-foreground">{t.settings.mcpHint}</p>

      <form className="mcp-add flex flex-col gap-1.5" onSubmit={(event) => void add(event)}>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="mcp-add-name h-8 w-36 font-mono text-xs"
            aria-label={t.settings.mcpName}
            placeholder={t.settings.mcpNamePlaceholder}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            className="mcp-add-target h-8 min-w-0 flex-1 font-mono text-xs"
            aria-label={t.settings.mcpTarget}
            placeholder={t.settings.mcpTargetPlaceholder}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={adding || !name.trim() || !target.trim()}>
            {adding ? t.settings.mcpAdding : t.settings.mcpAdd}
          </Button>
        </div>
        {formError && (
          <p className="mcp-add-error text-[11.5px] leading-snug text-destructive" role="alert">
            {formError}
          </p>
        )}
      </form>

      <ul className="mcp-list flex flex-col gap-3">
        {overview && servers.length === 0 && (
          <li className="setting-help text-[11.5px] text-muted-foreground">{t.settings.mcpEmpty}</li>
        )}
        {servers.map((server) => (
          <McpServerRow
            key={server.id}
            server={server}
            busy={busy === server.id}
            onToggle={(enabled) => void run(server.id, () => window.bonaparte.setMcpServerEnabled(server.id, enabled))}
            onRetry={() => void run(server.id, () => window.bonaparte.reloadMcpServers())}
            onRemove={() => void run(server.id, () => window.bonaparte.removeMcpServer(server.id))}
          />
        ))}
      </ul>

      {errors.length > 0 && (
        <div className="mcp-file-errors flex flex-col gap-1 text-[11.5px] leading-snug text-destructive">
          <p>{t.settings.mcpFileErrors}</p>
          <ul className="list-disc ps-5">
            {errors.map((error) => (
              <li key={error.id}>
                <span className="font-mono">{error.id}</span> — {t.settings.mcpFileErrorCodes[error.code] ?? error.code}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mcp-file flex flex-wrap items-center gap-2 border-t pt-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => void window.bonaparte.editMcpConfig()}>
          <FileJson aria-hidden="true" />
          {t.settings.mcpEditFile}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() => void run('*', () => window.bonaparte.reloadMcpServers())}
        >
          <RotateCw aria-hidden="true" />
          {t.settings.mcpReload}
        </Button>
        {overview && (
          <span className="mcp-path min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={overview.configPath}>
            {overview.configPath}
          </span>
        )}
      </div>
    </div>
  );
}

function McpServerRow({
  server,
  busy,
  onToggle,
  onRetry,
  onRemove,
}: {
  server: McpServerDto;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslate();
  // Removing drops the entry from the file, its environment and headers
  // with it: a second click confirms.
  const [confirming, setConfirming] = useState(false);
  const state =
    server.state === 'connected'
      ? t.settings.mcpConnected.replace('{count}', () => String(server.tools.length))
      : server.state === 'connecting'
        ? t.settings.mcpConnecting
        : server.state === 'failed'
          ? t.settings.mcpFailed
          : t.settings.mcpOff;
  return (
    <li className="mcp-row flex flex-col gap-1 border-b pb-3" data-state={server.state}>
      <div className="flex items-center gap-2">
        <span className="mcp-name font-mono text-[13px]">{server.id}</span>
        <Badge
          variant={server.state === 'failed' ? 'destructive' : 'secondary'}
          className={cn(
            'mcp-state font-mono text-[11px] font-normal',
            `mcp-state-${server.state}`,
            server.state === 'connected' && 'text-emerald-700 dark:text-emerald-300',
          )}
        >
          {state}
        </Badge>
        <span className="ms-auto" />
        {server.state === 'failed' && (
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onRetry}>
            {t.settings.mcpRetry}
          </Button>
        )}
        <Button
          type="button"
          variant={confirming ? 'destructive' : 'ghost'}
          size={confirming ? 'xs' : 'icon-xs'}
          className="mcp-remove"
          // The icon needs a name; the confirmation speaks for itself.
          aria-label={confirming ? undefined : t.settings.mcpRemove}
          title={t.settings.mcpRemove}
          disabled={busy}
          onClick={() => {
            if (confirming) onRemove();
            else setConfirming(true);
          }}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? t.settings.mcpConfirmRemove : <Trash2 aria-hidden="true" />}
        </Button>
        <Switch
          className="mcp-switch"
          checked={server.state !== 'off'}
          disabled={busy}
          aria-label={t.settings.mcpSwitch.replace('{name}', () => server.id)}
          onCheckedChange={onToggle}
        />
      </div>
      <p className="mcp-target truncate font-mono text-[11px] text-muted-foreground" title={server.target}>
        {server.target}
      </p>
      {server.state === 'connected' && server.tools.length > 0 && (
        <p className="mcp-tools text-[11.5px] leading-snug text-muted-foreground">{server.tools.join(' · ')}</p>
      )}
      {/* A failed server shows what it said: hiding it would leave the user
          without an explanation. */}
      {server.error && (
        <p className="mcp-error whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-destructive">
          {server.error}
        </p>
      )}
    </li>
  );
}
