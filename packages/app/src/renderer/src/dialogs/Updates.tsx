/**
 * « Mises à jour » (task 13.1, board « Une mise à jour », design §7.6): the
 * app, llama.cpp and the models — each card says what it costs before it is
 * done. Nothing installs under a reply: a button asked meanwhile says it
 * waits for the end of the turn. « Mettre à jour l'app toute seule » is the
 * app's alone; the engine and the model always ask.
 */

import {
  settingsGet,
  settingsSet,
  updatesKeep,
  updatesList,
  updatesLlama,
  updatesModel,
  updatesRestart,
  type UpdatesView,
} from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { bridge } from '../bridge';
import { formatBytes, formatDuration } from '../format';
import type { Messages } from '../i18n/index';
import { BICORNE } from '../logo/Mascot';
import { Icon, type IconName } from '../shell/icons';

export interface UpdatesProps {
  messages: Messages;
  locale: string;
  open: boolean;
  onClose(): void;
}

/** How many cards the dialog shows: the sidebar's entry counts the same. */
export function updatesCount(view: UpdatesView | null): number {
  return view ? (view.app ? 1 : 0) + (view.llama ? 1 : 0) + view.models.length : 0;
}

const percent = (progress: { done: number; total: number | null } | null): number | null =>
  progress && progress.total ? Math.min(100, Math.floor((progress.done / progress.total) * 100)) : null;

function Card({ icon, title, kind, notes, children, actions }: { icon: ReactNode; title: string; kind: string; notes: string; children: ReactNode; actions: ReactNode }) {
  return (
    <li className="update-card">
      <span className="update-card__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="update-card__text">
        <p className="update-card__title">
          <strong>{title}</strong> <span className="update-card__kind">{kind}</span>
        </p>
        <p className="update-card__notes">{notes}</p>
        {children}
      </div>
      <div className="update-card__actions">{actions}</div>
    </li>
  );
}

function Cost({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <p className="update-card__cost">
      <Icon name={icon} />
      <span>{children}</span>
    </p>
  );
}

export function UpdatesDialog({ messages, locale, open, onClose }: UpdatesProps) {
  const words = messages.updates;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const autoId = useId();
  const [view, setView] = useState<UpdatesView | null>(null);
  const [auto, setAuto] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [asked, setAsked] = useState<Set<string>>(() => new Set());
  const style = { locale, units: messages.units };
  const size = (bytes: number): string => formatBytes(bytes, style);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) return;
    setFailed(null);
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Read with a check of the releases first, then again while something downloads or waits.
    const read = (check: boolean): void => {
      void bridge.invoke(updatesList, { check }).then((next) => {
        if (!live) return;
        setView(next);
        const moving = next.app?.state === 'downloading' || next.app?.waiting || next.llama?.installing || next.models.some((one) => one.downloading);
        if (moving || next.busy) timer = setTimeout(() => read(false), 500);
      });
    };
    read(true);
    void bridge.invoke(settingsGet, { key: 'autoUpdateApp' }).then((value) => live && setAuto(value !== false));
    const off = bridge.on((event) => {
      if (event.kind === 'updates') read(false);
    });
    return () => {
      live = false;
      clearTimeout(timer);
      off();
    };
  }, [open]);

  const act = (key: string, run: () => Promise<void>): void => {
    setFailed(null);
    setAsked((before) => new Set(before).add(key));
    void run()
      .catch((error: unknown) => setFailed(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setAsked((before) => {
          const next = new Set(before);
          next.delete(key);
          return next;
        });
        void bridge.invoke(updatesList, { check: false }).then(setView);
      });
  };

  const waitingLabel = (key: string, progress: { done: number; total: number | null } | null, label: string): string => {
    const shown = percent(progress);
    if (shown !== null) return words.progress(shown);
    return asked.has(key) && view?.busy ? words.waiting : label;
  };

  const count = updatesCount(view);
  return (
    <dialog ref={dialog} className="aparte-dialog updates-dialog" aria-labelledby={titleId} onClose={onClose}>
      <header className="aparte-dialog__header updates-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {words.title}
        </h2>
        <button type="button" className="aparte-btn aparte-btn--ghost aparte-btn--icon" aria-label={words.close} title={words.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="aparte-dialog__body updates-dialog__body">
        <p className="updates-dialog__intro">{count > 0 ? words.intro(count) : words.none}</p>
        {count > 0 ? (
          <ul className="updates-dialog__list">
            {view?.app ? (
              <Card
                icon={
                  <svg className="update-card__mark" viewBox="0 0 120 100">
                    <path d={BICORNE} />
                  </svg>
                }
                title={words.appTitle(view.app.version)}
                kind={words.appKind}
                notes={view.app.notes ?? words.appNotes}
                actions={
                  <button
                    type="button"
                    className="aparte-btn aparte-btn--primary aparte-btn--solid update-card__restart"
                    disabled={asked.has('app') || view.app.waiting}
                    onClick={() => act('app', () => bridge.invoke(updatesRestart, undefined))}
                  >
                    {view.app.waiting ? words.waiting : waitingLabel('app', view.app.progress, words.restart)}
                  </button>
                }
              >
                <Cost icon="clock">
                  {words.appCost}
                  {view.app.state === 'available' && view.app.bytes !== null && !auto ? ` ${words.appDownload(size(view.app.bytes))}` : ''}
                </Cost>
              </Card>
            ) : null}
            {view?.llama ? (
              <Card
                icon={<Icon name="engine" />}
                title={words.llamaTitle(view.llama.build)}
                kind={words.llamaKind}
                notes={words.llamaNotes(size(view.llama.bytes))}
                actions={
                  <button
                    type="button"
                    className="aparte-btn aparte-btn--outline update-card__llama"
                    disabled={asked.has('llama') || view.llama.installing !== null}
                    onClick={() => act('llama', () => bridge.invoke(updatesLlama, undefined))}
                  >
                    {waitingLabel('llama', view.llama.installing, words.update)}
                  </button>
                }
              >
                <Cost icon="clock">{words.llamaCost}</Cost>
              </Card>
            ) : null}
            {view?.models.map((model) => (
              <Card
                key={model.id}
                icon={<Icon name="layers" />}
                title={model.name}
                kind={words.modelKind}
                notes={words.modelNotes}
                actions={null}
              >
                <p className="aparte-alert aparte-alert--warning update-card__warning" role="note">
                  <Icon name="alert" />
                  <span>{words.modelCost(size(model.bytes), model.reread.conversations, formatDuration(model.reread.seconds, locale))}</span>
                </p>
                <div className="update-card__buttons">
                  <button
                    type="button"
                    className="aparte-btn aparte-btn--outline update-card__download"
                    disabled={asked.has(model.id) || model.downloading !== null}
                    onClick={() => act(model.id, () => bridge.invoke(updatesModel, { id: model.id }))}
                  >
                    {waitingLabel(model.id, model.downloading, words.download)}
                  </button>
                  <button
                    type="button"
                    className="aparte-btn aparte-btn--ghost update-card__keep"
                    disabled={asked.has(model.id) || model.downloading !== null}
                    onClick={() => act(`keep:${model.id}`, () => bridge.invoke(updatesKeep, { id: model.id }))}
                  >
                    {words.keep}
                  </button>
                </div>
              </Card>
            ))}
          </ul>
        ) : null}
        {failed ? (
          <p className="aparte-field-warning" role="alert">
            {words.failed(failed)}
          </p>
        ) : null}
        <footer className="updates-dialog__footer">
        <input
          id={autoId}
          type="checkbox"
          role="switch"
          className="aparte-switch aparte-switch--primary updates-dialog__auto"
          checked={auto}
          aria-label={words.auto}
          onChange={(event) => {
            const next = event.target.checked;
            setAuto(next);
            void bridge.invoke(settingsSet, { key: 'autoUpdateApp', value: next });
          }}
        />
        <label htmlFor={autoId} className="updates-dialog__auto-label">
          <strong>{words.auto}</strong> {words.autoHint}
        </label>
        <p className="updates-dialog__note">{words.note}</p>
        </footer>
      </div>
    </dialog>
  );
}
