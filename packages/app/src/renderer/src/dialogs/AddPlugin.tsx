/**
 * « Ajouter un plugin » (task 11.3, board « Ajouter un plugin »): from a folder, from npm, or from a git repository.
 * The plugin is read before anything of it runs — its manifest, « auteur non vérifié », what it will be able to do
 * and what it will add —, then added switched on or off. « Annuler » lets go of what was read. The folder is chosen
 * by the system's dialog in the main process; the window never runs anything.
 */

import {
  localize,
  pluginsDiscard,
  pluginsInstall,
  pluginsPickFolder,
  pluginsPreview,
  type Locale,
  type PluginAddRequestView,
  type PluginManifest,
  type PluginStatus,
} from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';

type Source = 'folder' | 'npm' | 'git';
type Read = { stagingId: string; manifest: PluginManifest; replaces?: string };

const EFFECT_STYLE = { read: 'aparte-badge--neutral', write: 'aparte-badge--warning', execute: 'aparte-badge--danger', network: 'aparte-badge--info' } as const;

export interface AddPluginDialogProps {
  open: boolean;
  messages: Messages;
  locale: Locale;
  onClose(): void;
  onAdded(plugins: PluginStatus[]): void;
}

export function AddPluginDialog({ open, messages, locale, onClose, onAdded }: AddPluginDialogProps) {
  const words = messages.plugins.addDialog;
  const effects = messages.plugins.effects;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [source, setSource] = useState<Source>('folder');
  const [folder, setFolder] = useState('');
  const [npm, setNpm] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [gitRef, setGitRef] = useState('');
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<Read | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setRead(null);
      setFailure(null);
      element.showModal();
    } else if (!open && element.open) element.close();
  }, [open]);

  const letGo = (): void => {
    if (read) void bridge.invoke(pluginsDiscard, { stagingId: read.stagingId });
    setRead(null);
  };
  const close = (): void => {
    letGo();
    onClose();
  };

  const request = (): PluginAddRequestView | null => {
    if (source === 'folder') return folder.trim() ? { kind: 'folder', path: folder.trim() } : null;
    if (source === 'npm') return npm.trim() ? { kind: 'npm', spec: npm.trim() } : null;
    return gitUrl.trim() ? { kind: 'git', url: gitUrl.trim(), ref: gitRef.trim() || 'main' } : null;
  };

  const readIt = async (): Promise<void> => {
    const asked = request();
    if (!asked) return;
    letGo();
    setFailure(null);
    setReading(true);
    try {
      const result = await bridge.invoke(pluginsPreview, asked);
      if (result.ok) setRead({ stagingId: result.preview.stagingId, manifest: result.preview.manifest as unknown as PluginManifest, ...(result.preview.replaces ? { replaces: result.preview.replaces } : {}) });
      else setFailure(result.error);
    } finally {
      setReading(false);
    }
  };

  const add = async (enable: boolean): Promise<void> => {
    if (!read) return;
    setAdding(true);
    try {
      onAdded((await bridge.invoke(pluginsInstall, { stagingId: read.stagingId, enable })) as PluginStatus[]);
      setRead(null);
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setAdding(false);
    }
  };

  const adds = read
    ? [
        ...read.manifest.contributes.tools.map((tool) => words.tool(tool.name)),
        ...read.manifest.contributes.panes.map((pane) => words.pane(localize(pane.title, locale))),
        ...read.manifest.contributes.commands.map((command) => words.command(command.name)),
      ]
    : [];

  const field = (label: string, value: string, change: (text: string) => void, extra: { placeholder?: string; code?: boolean } = {}) => (
    <label className="add-plugin__field">
      <span className="aparte-field-label">{label}</span>
      <input
        type="text"
        className={`aparte-field${extra.code ? ' add-plugin__code' : ''}`}
        value={value}
        spellCheck={false}
        {...(extra.placeholder ? { placeholder: extra.placeholder } : {})}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void readIt();
          }
        }}
      />
    </label>
  );

  return (
    <dialog ref={dialog} className="aparte-dialog aparte-dialog--lg add-plugin" aria-labelledby={titleId} data-aparte-dialog-static="" onClose={close}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {words.title}
        </h2>
        <button type="button" className="aparte-dialog__close aparte-btn aparte-btn--icon aparte-btn--ghost" aria-label={words.close} onClick={close}>
          <Icon name="close" />
        </button>
      </header>
      <div className="aparte-dialog__body add-plugin__body">
        <div role="radiogroup" aria-label={words.source} className="aparte-segmented">
          {(['folder', 'npm', 'git'] as const).map((one) => (
            <label key={one} className="aparte-segmented__item">
              <input
                type="radio"
                name="add-plugin-source"
                checked={source === one}
                onChange={() => {
                  letGo();
                  setFailure(null);
                  setSource(one);
                }}
              />
              <span>{words[one]}</span>
            </label>
          ))}
        </div>

        {source === 'folder' ? (
          <div className="add-plugin__row">
            {field(words.folderLabel, folder, setFolder, { code: true })}
            <button
              type="button"
              className="aparte-btn aparte-btn--outline"
              onClick={() =>
                void bridge.invoke(pluginsPickFolder, undefined).then(({ path }) => {
                  if (path) setFolder(path);
                })
              }
            >
              {words.browse}
            </button>
          </div>
        ) : null}
        {source === 'npm' ? (
          <>
            {field(words.npmLabel, npm, setNpm, { placeholder: words.npmPlaceholder, code: true })}
            <p className="aparte-field-hint">{words.npmHelp}</p>
          </>
        ) : null}
        {source === 'git' ? (
          <div className="add-plugin__row">
            {field(words.gitUrl, gitUrl, setGitUrl, { placeholder: words.gitUrlPlaceholder, code: true })}
            {field(words.gitRef, gitRef, setGitRef, { placeholder: words.gitRefPlaceholder, code: true })}
          </div>
        ) : null}
        <button type="button" className="aparte-btn aparte-btn--outline aparte-btn--sm add-plugin__read" disabled={reading || request() === null} onClick={() => void readIt()}>
          {reading ? words.reading : words.read}
        </button>

        {failure ? (
          <p className="aparte-field-warning" role="alert">
            {words.failed(failure)}
          </p>
        ) : null}

        {read ? (
          <section className="add-plugin__preview" aria-label={localize(read.manifest.name, locale)}>
            <div className="add-plugin__name">
              <strong>{localize(read.manifest.name, locale)}</strong>
              <span className="add-plugin__version">{read.manifest.version}</span>
              <span className="add-plugin__meta">{words.manifestRead}</span>
              {read.replaces ? <span className="add-plugin__meta">{words.replaces(read.replaces)}</span> : null}
            </div>
            <h3 className="add-plugin__subtitle">{words.before}</h3>
            {read.manifest.effects.length === 0 ? (
              <p className="add-plugin__meta">{words.nothing}</p>
            ) : (
              <ul className="add-plugin__effects">
                {read.manifest.effects.map((one, index) => (
                  <li key={index}>
                    <span className={`aparte-badge ${EFFECT_STYLE[one.effect]} aparte-badge--soft aparte-badge--sm`}>{effects[one.effect]}</span>
                    <span>{localize(one.what, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
            {adds.length > 0 ? <p className="add-plugin__adds">{words.willAdd(adds)}</p> : null}
          </section>
        ) : null}
        <p className="add-plugin__warning">{words.warning}</p>
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--ghost" onClick={close}>
          {words.cancel}
        </button>
        <button type="button" className="aparte-btn aparte-btn--outline" disabled={!read || adding} onClick={() => void add(false)}>
          {words.addOff}
        </button>
        <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" disabled={!read || adding} onClick={() => void add(true)}>
          {words.addOn}
        </button>
      </footer>
    </dialog>
  );
}
