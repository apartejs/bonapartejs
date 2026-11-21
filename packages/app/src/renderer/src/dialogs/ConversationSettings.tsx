/**
 * « Réglages de la conversation » (task 12.4, the built-in entry `conversation-settings`): its temperature, its
 * reasoning and its context cap — for this conversation only; an empty field keeps the default. Checked before it
 * is kept, said in the person's words. Below them, what « Pour cette conversation » kept, each taken back there.
 */

import { conversationsSettingsGet, conversationsSettingsSet, type ConversationSettingsView } from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { RememberedRules } from '../settings/RememberedRules';

export interface ConversationSettingsProps {
  messages: Messages;
  locale: string;
  /** The conversation asked about; null: closed. */
  conversationId: string | null;
  onClose(): void;
}

export function ConversationSettingsDialog({ messages, locale, conversationId, onClose }: ConversationSettingsProps) {
  const words = messages.conversationSettings;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const temperatureId = useId();
  const thinkingId = useId();
  const capId = useId();
  const rememberedId = useId();
  const [view, setView] = useState<ConversationSettingsView | null>(null);
  const [temperature, setTemperature] = useState('');
  const [thinking, setThinking] = useState<'default' | 'on' | 'off'>('default');
  const [cap, setCap] = useState('');
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (conversationId && !element.open) element.showModal();
    if (!conversationId && element.open) element.close();
    if (!conversationId) return;
    setRefused(null);
    let live = true;
    void bridge.invoke(conversationsSettingsGet, { id: conversationId }).then((read) => {
      if (!live) return;
      setView(read);
      setTemperature(read.temperature === null ? '' : String(read.temperature));
      setThinking(read.thinking === null ? 'default' : read.thinking ? 'on' : 'off');
      setCap(read.contextCap === null ? '' : String(read.contextCap));
    });
    return () => {
      live = false;
    };
  }, [conversationId]);

  const save = (): void => {
    if (!conversationId) return;
    const hot = temperature.trim() === '' ? null : Number(temperature.replace(',', '.'));
    if (hot !== null && !(Number.isFinite(hot) && hot >= 0 && hot <= 2)) {
      setRefused(words.badTemperature);
      return;
    }
    const capped = cap.trim() === '' ? null : Number(cap);
    if (capped !== null && !(Number.isInteger(capped) && capped >= 512)) {
      setRefused(words.badCap);
      return;
    }
    void bridge
      .invoke(conversationsSettingsSet, { id: conversationId, temperature: hot, thinking: thinking === 'default' ? null : thinking === 'on', contextCap: capped })
      .then(() => onClose())
      .catch((error: unknown) => setRefused(error instanceof Error ? error.message : String(error)));
  };

  const defaultTemperature = view ? new Intl.NumberFormat(locale).format(view.defaults.temperature) : '';
  return (
    <dialog ref={dialog} className="aparte-dialog conversation-settings" aria-labelledby={titleId} onClose={onClose}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {words.title}
        </h2>
      </header>
      <div className="aparte-dialog__body conversation-settings__body">
        <p className="aparte-field-hint">{words.hint}</p>
        <label className="aparte-field-label" htmlFor={temperatureId}>
          {words.temperature}
        </label>
        <input
          id={temperatureId}
          className="aparte-field"
          type="number"
          min={0}
          max={2}
          step={0.05}
          value={temperature}
          placeholder={defaultTemperature}
          onChange={(event) => setTemperature(event.target.value)}
        />
        <p className="aparte-field-hint">{words.temperatureHint(defaultTemperature)}</p>
        <label className="aparte-field-label" htmlFor={thinkingId}>
          {words.thinking}
        </label>
        <select id={thinkingId} className="aparte-field" value={thinking} onChange={(event) => setThinking(event.target.value as typeof thinking)}>
          <option value="default">{words.thinkingDefault(view?.defaults.thinking ?? true)}</option>
          <option value="on">{words.thinkingOn}</option>
          <option value="off">{words.thinkingOff}</option>
        </select>
        <label className="aparte-field-label" htmlFor={capId}>
          {words.contextCap}
        </label>
        <input id={capId} className="aparte-field" type="number" min={512} step={512} value={cap} onChange={(event) => setCap(event.target.value)} />
        <p className="aparte-field-hint">{words.contextCapHint}</p>
        {conversationId ? (
          <section className="conversation-settings__remembered" aria-labelledby={rememberedId}>
            <h3 id={rememberedId} className="aparte-field-label">
              {words.remembered}
            </h3>
            <p className="aparte-field-hint">{words.rememberedHint}</p>
            <RememberedRules messages={messages} projectId={null} conversationId={conversationId} />
          </section>
        ) : null}
        {refused ? (
          <p className="aparte-field-warning" role="alert">
            {refused}
          </p>
        ) : null}
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--ghost" onClick={onClose}>
          {words.cancel}
        </button>
        <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={save}>
          {words.save}
        </button>
      </footer>
    </dialog>
  );
}
