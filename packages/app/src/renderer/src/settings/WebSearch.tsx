/**
 * « Recherche web » · Réglages (task 11.3, deferred from 10.4): where the agent searches — the public engine without
 * a key, or an online provider. A provider's key goes to the system's vault and is never shown again: the window
 * only hears whether one is kept. SearXNG takes the address of its instance.
 */

import { searchKeysList, searchKeysSet, settingsAll, settingsSet } from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';

type Provider = 'embedded' | 'brave' | 'tavily' | 'serper' | 'searxng';
type Keyed = 'brave' | 'tavily' | 'serper';
const KEYED = new Set<Provider>(['brave', 'tavily', 'serper']);

export function WebSearchDialog({ open, messages, onClose }: { open: boolean; messages: Messages; onClose(): void }) {
  const words = messages.plugins.search;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [provider, setProvider] = useState<Provider>('embedded');
  const [url, setUrl] = useState('');
  const [kept, setKept] = useState<Record<Keyed, boolean>>({ brave: false, tavily: false, serper: false });
  const [key, setKey] = useState('');

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setKey('');
      void bridge.invoke(settingsAll, undefined).then((all) => {
        const value = (name: string) => all.find((one) => one.key === name)?.value;
        setProvider((value('webSearchProvider') as Provider | undefined) ?? 'embedded');
        setUrl(String(value('webSearchUrl') ?? ''));
      });
      void bridge.invoke(searchKeysList, undefined).then(setKept);
      element.showModal();
    } else if (!open && element.open) element.close();
  }, [open]);

  const choose = (next: Provider): void => {
    setProvider(next);
    setKey('');
    void bridge.invoke(settingsSet, { key: 'webSearchProvider', value: next });
  };

  return (
    <dialog ref={dialog} className="aparte-dialog web-search-dialog" aria-labelledby={titleId} onClose={onClose}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {words.title}
        </h2>
        <button type="button" className="aparte-dialog__close aparte-btn aparte-btn--icon aparte-btn--ghost" aria-label={words.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="aparte-dialog__body add-plugin__body">
        <p className="aparte-field-hint">{words.intro}</p>
        <fieldset className="aparte-fieldset">
          <legend className="aparte-field-label">{words.provider}</legend>
          {(['embedded', 'brave', 'tavily', 'serper', 'searxng'] as const).map((one) => (
            <label key={one} className="aparte-field-choice">
              <input type="radio" className="aparte-radio" name="web-search-provider" checked={provider === one} onChange={() => choose(one)} />
              <span>{words.providers[one]}</span>
            </label>
          ))}
        </fieldset>
        {KEYED.has(provider) ? (
          <div className="add-plugin__row">
            <label className="add-plugin__field">
              <span className="aparte-field-label">{words.key}</span>
              <input type="password" className="aparte-field" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} />
            </label>
            <button
              type="button"
              className="aparte-btn aparte-btn--outline"
              disabled={key.trim() === ''}
              onClick={() =>
                void bridge.invoke(searchKeysSet, { provider: provider as Keyed, key }).then((next) => {
                  setKept(next);
                  setKey('');
                })
              }
            >
              {words.saveKey}
            </button>
            {kept[provider as Keyed] ? (
              <button type="button" className="aparte-btn aparte-btn--ghost" onClick={() => void bridge.invoke(searchKeysSet, { provider: provider as Keyed, key: null }).then(setKept)}>
                {words.forgetKey}
              </button>
            ) : null}
          </div>
        ) : null}
        {KEYED.has(provider) ? <p className="aparte-field-hint">{kept[provider as Keyed] ? words.keyKept : words.keyNone}</p> : null}
        {provider === 'searxng' ? (
          <label className="add-plugin__field">
            <span className="aparte-field-label">{words.url}</span>
            <input
              type="text"
              className="aparte-field"
              placeholder={words.urlPlaceholder}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onBlur={() => void bridge.invoke(settingsSet, { key: 'webSearchUrl', value: url.trim() })}
            />
          </label>
        ) : null}
      </div>
    </dialog>
  );
}
