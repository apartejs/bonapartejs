import type {
  BackendConfigDto,
  BackendStatusDto,
  CompletionStatsDto,
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
  restore: RestoreDto | null;
  lastStats: CompletionStatsDto | null;
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

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function StatusStrip({
  backendStatus,
  engine,
  streaming,
  modelName,
  nCtx,
  restore,
  lastStats,
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
  const usedTokens = lastStats?.progress?.total ?? null;
  const contextPct =
    usedTokens !== null && nCtx ? Math.min(100, Math.round((usedTokens / nCtx) * 100)) : null;

  // The only engine is llama.cpp, which always knows how to persist: an
  // engine just needs to be connected for the button to keep its promise.
  const canPersistKv = engine !== undefined;

  return (
    <footer className="status-strip">
      <div className="status-left">
        <Mascotte state={mascotteFor(backendStatus, streaming)} />
        <span className={`status-pill status-${backendStatus}`}>
          {t.status[backendStatus]}
        </span>
        {/* This bar now carries only what's GLOBAL: engine state, loaded
            model, context gauge, measurements. The folder moved into the
            conversation header, and the play mode into the composer — it
            decides what the agent is allowed to do on the next message, so
            it belongs to the act of sending. */}
        {modelName && (
          <span className="status-chip chip-model" title={modelName}>
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
          <span className="status-chip chip-dim">{t.status.notConnected}</span>
        ) : restore ? (
          <span
            className={`status-chip ${restore.restored ? 'chip-ok' : 'chip-dim'}`}
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
          <span className="status-chip chip-dim">
            {t.status.prefill} {formatMs(lastStats.promptMs)}
            {cachePct !== null && ` · ${t.status.cacheShare} ${cachePct}%`}
          </span>
        )}
      </div>

      <div className="status-right">
        {saveState !== 'idle' && (
          <span className={saveState === 'saved' ? 'chip-ok status-chip' : 'chip-err status-chip'}>
            {saveState === 'saved' ? t.status.saved : t.status.saveFailed}
          </span>
        )}
        {canPersistKv && (
          <button type="button" onClick={onSave}>
            {t.status.save}
          </button>
        )}
        <button type="button" onClick={onOpenSettings}>
          {t.settings.heading}
        </button>
      </div>
    </footer>
  );
}
