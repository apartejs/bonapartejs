import type {
  BackendStatusDto,
  CompletionStatsDto,
  RestoreDto,
} from '@aparte/bonaparte-shared';
import { Mascotte } from '../mascotte/Mascotte.js';
import type { MascotteState } from '../mascotte/mascotte-states.js';
import { useTranslate } from '../i18n/LocaleProvider.js';

interface StatusStripProps {
  backendStatus: BackendStatusDto;
  streaming: boolean;
  restore: RestoreDto | null;
  lastStats: CompletionStatsDto | null;
  saveState: 'idle' | 'saved' | 'failed';
  onSave: () => void;
  onChangeBackend: () => void;
  onToggleTheme: () => void;
  onToggleLocale: () => void;
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
  streaming,
  restore,
  lastStats,
  saveState,
  onSave,
  onChangeBackend,
  onToggleTheme,
  onToggleLocale,
}: StatusStripProps) {
  const { t } = useTranslate();

  const cachePct =
    lastStats?.progress && lastStats.progress.total > 0
      ? Math.round((lastStats.progress.cache / lastStats.progress.total) * 100)
      : null;

  return (
    <footer className="status-strip">
      <div className="status-left">
        <Mascotte state={mascotteFor(backendStatus, streaming)} />
        <span className={`status-pill status-${backendStatus}`}>
          {t.status[backendStatus]}
        </span>
        {restore && (
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
        )}
        {lastStats && (
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
        <button type="button" onClick={onSave}>
          {t.status.save}
        </button>
        <button type="button" onClick={onChangeBackend}>
          {t.status.changeBackend}
        </button>
        <button type="button" onClick={onToggleTheme}>
          {t.actions.toggleTheme}
        </button>
        <button type="button" onClick={onToggleLocale}>
          {t.actions.toggleLocale}
        </button>
      </div>
    </footer>
  );
}
