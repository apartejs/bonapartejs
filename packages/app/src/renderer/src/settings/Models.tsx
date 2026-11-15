/**
 * « Réglages · Modèles » (board): where models are looked for — the folders
 * the person added, « Ajouter un dossier » (the system's dialog), the search
 * of the whole disk with how far it went and « Annuler » —; then the models
 * found: their size, their memory per token, the video memory they take,
 * when they were last loaded, and which one is the default.
 */

import {
  engineModels,
  engineState,
  modelsAddFolder,
  modelsScanCancel,
  modelsScanDisk,
  modelsScanState,
  type DiskScanStateView,
  type ModelChoiceView,
} from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import { formatBytes, type NumberStyle } from '../format';
import type { PageProps } from './SettingsView';

function lastTime(model: ModelChoiceView, running: string | null, words: PageProps['messages']['settings']['models'], locale: string): string {
  if (model.path === running) return words.running;
  if (!model.lastLoadedAt) return words.never;
  const at = new Date(model.lastLoadedAt);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at);
  if (days === 1) return words.yesterday;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at);
}

export function ModelsPage({ messages, locale, values, change }: PageProps) {
  const words = messages.settings.models;
  const style: NumberStyle = { locale, units: messages.units };
  const [models, setModels] = useState<ModelChoiceView[] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [scan, setScan] = useState<DiskScanStateView | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const folders = Array.isArray(values['modelFolders']) ? (values['modelFolders'] as string[]) : [];

  const read = (): void => {
    void bridge.invoke(engineModels, undefined).then(setModels).catch(() => setModels([]));
    void bridge
      .invoke(engineState, undefined)
      .then((state) => setRunning(state.model?.path ?? null))
      .catch(() => undefined);
  };
  useEffect(read, []);

  // While the disk is searched: how far it went, read again every half second.
  useEffect(() => {
    if (!scan?.running) return;
    const timer = setInterval(() => {
      void bridge.invoke(modelsScanState, undefined).then((state) => {
        setScan(state);
        if (state.done) {
          setSaid(state.cancelled ? words.scanCancelled : state.folders.length > 0 ? words.scanFound(state.folders.length) : words.scanNothing);
          if (!state.cancelled && state.folders.length > 0) change('modelFolders', [...new Set([...folders, ...state.folders])]);
          read();
        }
      });
    }, 500);
    return () => clearInterval(timer);
  }, [scan?.running]);

  const count = (folder: string): number =>
    (models ?? []).filter((model) => model.path.toLowerCase().startsWith(folder.toLowerCase().replace(/[\\/]+$/, '') + (folder.includes('\\') ? '\\' : '/')))
      .length;

  return (
    <div className="settings__sections">
      <p className="settings__intro">{words.intro}</p>
      <section className="setting-section" aria-label={words.where}>
        <h2 className="setting-section__title">{words.where}</h2>
        {folders.length === 0 ? <p className="setting-section__hint">{words.noFolder}</p> : null}
        {folders.map((folder) => (
          <div key={folder} className="model-folder">
            <code className="model-folder__path">{folder}</code>
            <span className="model-folder__count">{words.folderCount(count(folder))}</span>
          </div>
        ))}
        <div className="setting-actions">
          <button
            type="button"
            className="aparte-btn aparte-btn--outline"
            onClick={() => {
              void bridge.invoke(modelsAddFolder, undefined).then((next) => {
                if (next) {
                  change('modelFolders', next);
                  read();
                }
              });
            }}
          >
            {words.addFolder}
          </button>
          {scan?.running ? (
            <button type="button" className="aparte-btn aparte-btn--ghost" onClick={() => void bridge.invoke(modelsScanCancel, undefined).then(setScan)}>
              {words.cancel}
            </button>
          ) : (
            <button
              type="button"
              className="aparte-btn aparte-btn--ghost aparte-btn--primary"
              onClick={() => {
                setSaid(null);
                void bridge.invoke(modelsScanDisk, undefined).then(setScan);
              }}
            >
              {words.scanDisk}
            </button>
          )}
        </div>
        {scan?.running ? (
          <p className="setting-section__hint" role="status">
            {words.scanning(scan.visited)}
          </p>
        ) : said ? (
          <p className="setting-section__hint" role="status">
            {said}
          </p>
        ) : null}
      </section>
      <div className="settings-table-wrap">
        <table className="settings-table">
          <thead>
            <tr>
              <th scope="col">{words.columns.model}</th>
              <th scope="col" className="settings-table__number">
                {words.columns.size}
              </th>
              <th scope="col" className="settings-table__number">
                {words.columns.perToken}
              </th>
              <th scope="col" className="settings-table__number">
                {words.columns.vram}
              </th>
              <th scope="col">{words.columns.last}</th>
              <th scope="col">{words.columns.preferred}</th>
            </tr>
          </thead>
          <tbody>
            {(models ?? []).map((model) => (
              <tr key={model.path} className={`model-row${model.path === running ? ' model-row--running' : ''}`}>
                <td className="model-row__name">{model.name}</td>
                <td className="settings-table__number">{formatBytes(model.sizeBytes, style)}</td>
                <td className="settings-table__number">{model.kvBytesPerToken === null ? '—' : formatBytes(model.kvBytesPerToken, style)}</td>
                <td className="settings-table__number">{model.announcement ? formatBytes(model.announcement.vramBytes, style) : '—'}</td>
                <td>{lastTime(model, running, words, locale)}</td>
                <td>
                  <input
                    type="radio"
                    className="aparte-radio aparte-radio--primary"
                    name="default-model"
                    aria-label={words.preferredOf(model.name)}
                    checked={values['defaultModel'] === model.path}
                    onChange={() => change('defaultModel', model.path)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {models && models.length === 0 ? <p className="setting-section__hint">{words.empty}</p> : null}
      </div>
      <p className="settings__footnote">{words.footnote}</p>
    </div>
  );
}
