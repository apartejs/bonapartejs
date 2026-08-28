import type {
  BackendConfigDto,
  BackendStatusDto,
  CompletionStatsDto,
  ResourceSampleDto,
  RestoreDto,
} from '@aparte/bonaparte-shared';
import { Badge, Button, Progress, cn } from '@aparte/bonaparte-plugin-sdk/ui';
import { Mascotte } from '../mascotte/Mascotte.js';
import type { MascotteState } from '../mascotte/mascotte-states.js';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface StatusStripProps {
  backendStatus: BackendStatusDto;
  engine: BackendConfigDto | undefined;
  streaming: boolean;
  modelName: string | null;
  /** Conversation's context size — the gauge's denominator. */
  nCtx: number | null;
  /** Tokens in the slot when the conversation opened (a restored state), until the first turn. */
  contextAtOpen: number | null;
  restore: RestoreDto | null;
  lastStats: CompletionStatsDto | null;
  /** The machine, sampled every few seconds — null until the first sample. */
  resources: ResourceSampleDto | null;
  saveState: 'idle' | 'saved' | 'failed';
  onSave: () => void;
  onOpenSettings: () => void;
}

function mascotteFor(status: BackendStatusDto, streaming: boolean): MascotteState {
  if (streaming) return 'talking';
  switch (status) {
    case 'ready':
      return 'idle';
    case 'starting':
    case 'restarting':
      return 'thinking';
    case 'crashed':
      return 'error';
    default:
      return 'sleeping';
  }
}

function gib(bytes: number | undefined | null, unit: string): string {
  if (bytes === undefined || bytes === null) return '—';
  return `${(bytes / 1024 ** 3).toFixed(1)} ${unit}`;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

const OK = 'text-emerald-700 dark:text-emerald-300';

/** The engine pill: an outline, coloured by what the engine is doing. */
function pillClass(status: BackendStatusDto): string {
  switch (status) {
    case 'ready':
      return `border-emerald-600/40 ${OK}`;
    case 'starting':
    case 'restarting':
      return 'border-primary/40 text-primary';
    case 'crashed':
      return 'border-destructive/40 text-destructive';
    default:
      return 'text-muted-foreground';
  }
}

/** A chip of the strip: a soft badge whose ink says whether the news is good. */
function chipClass(kind: 'ok' | 'dim' | 'err'): string {
  return cn(
    'status-chip text-xs font-normal',
    kind === 'ok' && `chip-ok ${OK}`,
    kind === 'dim' && 'chip-dim text-muted-foreground',
    kind === 'err' && 'chip-err text-destructive',
  );
}

export function StatusStrip({
  backendStatus,
  engine,
  streaming,
  modelName,
  nCtx,
  contextAtOpen,
  restore,
  lastStats,
  resources,
  saveState,
  onSave,
  onOpenSettings,
}: StatusStripProps) {
  const { t } = useTranslate();

  const cachePct =
    lastStats?.progress && lastStats.progress.total > 0
      ? Math.round((lastStats.progress.cache / lastStats.progress.total) * 100)
      : null;

  // Context gauge: what the last prompt occupied out of what we can hold.
  // Without both numbers, we display nothing rather than an estimate.
  // What the slot holds — prompt and replies — after the last turn; before
  // any turn, what the restored state brought in.
  const usedTokens = lastStats?.contextTokens ?? lastStats?.progress?.total ?? contextAtOpen;
  const contextPct =
    usedTokens !== null && nCtx ? Math.min(100, Math.round((usedTokens / nCtx) * 100)) : null;

  // The only engine is llama.cpp, which always knows how to persist: an
  // engine just needs to be connected for the button to keep its promise.
  const canPersistKv = engine !== undefined;

  return (
    <footer className="status-strip flex flex-wrap items-center justify-between gap-3 border-t bg-card px-3.5 py-2 text-[12.5px]">
      <div className="status-left flex flex-wrap items-center gap-2.5">
        <Mascotte state={mascotteFor(backendStatus, streaming)} />
        <Badge
          variant="outline"
          className={cn(
            'status-pill font-mono text-[11px] font-normal tracking-[0.06em]',
            `status-${backendStatus}`,
            pillClass(backendStatus),
          )}
        >
          {t.status[backendStatus]}
        </Badge>
        {/* This bar now carries only what's GLOBAL: engine state, loaded
            model, context gauge, measurements. The folder moved into the
            conversation header, and the play mode into the composer — it
            decides what the agent is allowed to do on the next message, so
            it belongs to the act of sending. */}
        {modelName && (
          <Badge
            variant="outline"
            className="status-chip chip-model block max-w-[220px] truncate font-mono font-normal text-(--aparte-secondary)"
            title={modelName}
          >
            {modelName}
          </Badge>
        )}
        {contextPct !== null && (
          <span
            className="context-gauge inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
            title={`${usedTokens} / ${nCtx} tokens`}
            aria-label={`${contextPct}%`}
          >
            {/* The context filling up is useful information BEFORE saturation. */}
            <Progress
              value={contextPct}
              className={cn(
                'context-gauge-track h-[5px] w-14 bg-input',
                contextPct >= 85 && 'context-gauge-hot [&>[data-slot=progress-indicator]]:bg-destructive',
              )}
            />
            <span className="context-gauge-text">{contextPct}%</span>
          </span>
        )}

        {restore && restore.restored === false && restore.reason === 'not-connected' ? (
          <Badge variant="secondary" className={chipClass('dim')}>
            {t.status.notConnected}
          </Badge>
        ) : restore ? (
          <Badge
            variant="secondary"
            className={chipClass(restore.restored ? 'ok' : 'dim')}
            title={
              restore.restored
                ? undefined
                : (t.status.reasons[restore.reason] ?? restore.reason)
            }
          >
            {restore.restored
              ? `${t.status.restored} · ${restore.nRestored} tokens`
              : `${t.status.notRestored} · ${t.status.reasons[restore.reason] ?? restore.reason}`}
          </Badge>
        ) : null}
        {lastStats && lastStats.promptMs > 0 && (
          <Badge variant="secondary" className={chipClass('dim')}>
            {t.status.prefill} {formatMs(lastStats.promptMs)}
            {cachePct !== null && ` · ${t.status.cacheShare} ${cachePct}%`}
          </Badge>
        )}
      </div>

      {resources && (
        <span className="res-group ms-auto inline-flex items-center gap-1.5" role="group" aria-label={t.resources.heading}>
          {resources.cpu !== null && (
            <Badge
              variant="secondary"
              className="res-chip font-mono text-[11px] font-normal whitespace-nowrap text-muted-foreground tabular-nums"
              title={t.resources.cpuHint
                .replace('{app}', resources.app?.cpu === null || resources.app?.cpu === undefined ? '—' : `${resources.app.cpu} %`)
                .replace('{server}', resources.server?.cpu === null || resources.server?.cpu === undefined ? '—' : `${resources.server.cpu} %`)}
            >
              CPU {Math.round(resources.cpu)} %
            </Badge>
          )}
          <Badge
            variant="secondary"
            className="res-chip font-mono text-[11px] font-normal whitespace-nowrap text-muted-foreground tabular-nums"
            title={t.resources.ramHint
              .replace('{app}', gib(resources.app?.workingSetBytes, t.units.gib))
              .replace('{server}', gib(resources.server?.workingSetBytes, t.units.gib))}
          >
            RAM {gib(resources.memory.usedBytes, t.units.gib)} / {gib(resources.memory.totalBytes, t.units.gib)}
          </Badge>
          {resources.gpu && (
            <Badge
              variant="secondary"
              className="res-chip font-mono text-[11px] font-normal whitespace-nowrap text-muted-foreground tabular-nums"
              title={t.resources.gpuHint}
            >
              GPU {gib(resources.gpu.dedicatedBytes, t.units.gib)}
              {resources.gpu.sharedBytes > 0 ? ` + ${gib(resources.gpu.sharedBytes, t.units.gib)}` : ''}
              {resources.gpu.utilization !== null ? ` · ${Math.round(resources.gpu.utilization)} %` : ''}
            </Badge>
          )}
        </span>
      )}
      <div className="status-right flex items-center gap-2.5">
        {saveState !== 'idle' && (
          <Badge variant="secondary" className={chipClass(saveState === 'saved' ? 'ok' : 'err')}>
            {saveState === 'saved' ? t.status.saved : t.status.saveFailed}
          </Badge>
        )}
        {canPersistKv && (
          <Button type="button" variant="secondary" size="sm" onClick={onSave}>
            {t.status.save}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onOpenSettings}>
          {t.settings.heading}
        </Button>
      </div>
    </footer>
  );
}
