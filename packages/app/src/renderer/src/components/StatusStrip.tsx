import type {
  BackendConfigDto,
  BackendStatusDto,
  CompletionStatsDto,
  ResourceSampleDto,
  RestoreDto,
} from '@aparte/bonaparte-shared';
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

/** aparté badge intent + fill for the engine status pill. */
function statusPillClass(status: BackendStatusDto): string {
  switch (status) {
    case 'ready':
      return 'aparte-badge--success aparte-badge--soft';
    case 'starting':
    case 'restarting':
      return 'aparte-badge--info aparte-badge--soft';
    case 'crashed':
      return 'aparte-badge--danger aparte-badge--soft';
    default:
      return 'aparte-badge--neutral aparte-badge--outline';
  }
}

/** aparté badge classes shared by every `.status-chip` variant. */
function chipClass(kind: 'ok' | 'dim' | 'err'): string {
  switch (kind) {
    case 'ok':
      return 'aparte-badge aparte-badge--success aparte-badge--soft aparte-badge--sm';
    case 'err':
      return 'aparte-badge aparte-badge--danger aparte-badge--soft aparte-badge--sm';
    default:
      return 'aparte-badge aparte-badge--neutral aparte-badge--soft aparte-badge--sm';
  }
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
    <footer className="status-strip">
      <div className="status-left">
        <Mascotte state={mascotteFor(backendStatus, streaming)} />
        <span
          className={`status-pill status-${backendStatus} aparte-badge aparte-badge--sm ${statusPillClass(backendStatus)}`}
        >
          {t.status[backendStatus]}
        </span>
        {/* This bar now carries only what's GLOBAL: engine state, loaded
            model, context gauge, measurements. The folder moved into the
            conversation header, and the play mode into the composer — it
            decides what the agent is allowed to do on the next message, so
            it belongs to the act of sending. */}
        {modelName && (
          <span
            className="status-chip chip-model aparte-badge aparte-badge--neutral aparte-badge--outline aparte-badge--sm"
            title={modelName}
          >
            {modelName}
          </span>
        )}
        {contextPct !== null && (
          <span
            className="context-gauge"
            title={`${usedTokens} / ${nCtx} tokens`}
            aria-label={`${contextPct}%`}
          >
            <span className="context-gauge-track">
              <span
                className={`context-gauge-fill${contextPct >= 85 ? ' context-gauge-hot' : ''}`}
                style={{ width: `${contextPct}%` }}
              />
            </span>
            <span className="context-gauge-text">{contextPct}%</span>
          </span>
        )}

        {restore && restore.restored === false && restore.reason === 'not-connected' ? (
          <span className={`status-chip chip-dim ${chipClass('dim')}`}>
            {t.status.notConnected}
          </span>
        ) : restore ? (
          <span
            className={`status-chip ${restore.restored ? 'chip-ok' : 'chip-dim'} ${chipClass(
              restore.restored ? 'ok' : 'dim',
            )}`}
            title={
              restore.restored
                ? undefined
                : (t.status.reasons[restore.reason] ?? restore.reason)
            }
          >
            {restore.restored
              ? `${t.status.restored} · ${restore.nRestored} tokens`
              : `${t.status.notRestored} · ${t.status.reasons[restore.reason] ?? restore.reason}`}
          </span>
        ) : null}
        {lastStats && lastStats.promptMs > 0 && (
          <span className={`status-chip chip-dim ${chipClass('dim')}`}>
            {t.status.prefill} {formatMs(lastStats.promptMs)}
            {cachePct !== null && ` · ${t.status.cacheShare} ${cachePct}%`}
          </span>
        )}
      </div>

      {resources && (
        <span className="res-group" role="group" aria-label={t.resources.heading}>
          {resources.cpu !== null && (
            <span
              className="res-chip"
              title={t.resources.cpuHint
                .replace('{app}', resources.app?.cpu === null || resources.app?.cpu === undefined ? '—' : `${resources.app.cpu} %`)
                .replace('{server}', resources.server?.cpu === null || resources.server?.cpu === undefined ? '—' : `${resources.server.cpu} %`)}
            >
              CPU {Math.round(resources.cpu)} %
            </span>
          )}
          <span
            className="res-chip"
            title={t.resources.ramHint
              .replace('{app}', gib(resources.app?.workingSetBytes, t.units.gib))
              .replace('{server}', gib(resources.server?.workingSetBytes, t.units.gib))}
          >
            RAM {gib(resources.memory.usedBytes, t.units.gib)} / {gib(resources.memory.totalBytes, t.units.gib)}
          </span>
          {resources.gpu && (
            <span className="res-chip" title={t.resources.gpuHint}>
              GPU {gib(resources.gpu.dedicatedBytes, t.units.gib)}
              {resources.gpu.sharedBytes > 0 ? ` + ${gib(resources.gpu.sharedBytes, t.units.gib)}` : ''}
              {resources.gpu.utilization !== null ? ` · ${Math.round(resources.gpu.utilization)} %` : ''}
            </span>
          )}
        </span>
      )}
      <div className="status-right">
        {saveState !== 'idle' && (
          <span
            className={`status-chip ${saveState === 'saved' ? 'chip-ok' : 'chip-err'} ${chipClass(
              saveState === 'saved' ? 'ok' : 'err',
            )}`}
          >
            {saveState === 'saved' ? t.status.saved : t.status.saveFailed}
          </span>
        )}
        {canPersistKv && (
          <button
            type="button"
            className="aparte-btn aparte-btn--neutral aparte-btn--soft aparte-btn--sm"
            onClick={onSave}
          >
            {t.status.save}
          </button>
        )}
        <button
          type="button"
          className="aparte-btn aparte-btn--neutral aparte-btn--ghost aparte-btn--sm"
          onClick={onOpenSettings}
        >
          {t.settings.heading}
        </button>
      </div>
    </footer>
  );
}
