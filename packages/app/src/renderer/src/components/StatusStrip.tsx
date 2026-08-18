import type {
  BackendStatusDto,
  CompletionStatsDto,
  PlayModeDto,
  RestoreDto,
} from '@aparte/bonaparte-shared';
import { Mascotte } from '../mascotte/Mascotte.js';
import type { MascotteState } from '../mascotte/mascotte-states.js';
import { useTranslate } from '../i18n/LocaleProvider.js';

const MODES: PlayModeDto[] = ['lecture', 'repetition', 'plume', 'impro'];

interface StatusStripProps {
  backendStatus: BackendStatusDto;
  streaming: boolean;
  mode: PlayModeDto;
  onModeChange: (mode: PlayModeDto) => void;
  projectName: string | null;
  modelName: string | null;
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
  mode,
  onModeChange,
  projectName,
  modelName,
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
        {projectName && (
          <span className="status-chip chip-project" title={projectName}>
            {projectName}
          </span>
        )}
        {modelName && (
          <span className="status-chip chip-model" title={modelName}>
            {modelName}
          </span>
        )}
        <select
          className={`mode-select mode-${mode}`}
          value={mode}
          onChange={(e) => onModeChange(e.target.value as PlayModeDto)}
          title={t.modes.hint}
        >
          {MODES.map((value) => (
            <option key={value} value={value}>
              {t.modes[value]}
            </option>
          ))}
        </select>
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
