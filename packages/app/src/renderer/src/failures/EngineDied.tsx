/**
 * The engine stopped during a reply (task 12.3, board « Quand quelque chose casse », « Pendant une réponse »): what
 * is safe (the conversation, its journal on disk), what is lost (the memory of the last turn, read again in its
 * time), « Relancer et relire », and « Voir le journal du moteur » — llama.cpp's last lines, as it wrote them.
 */

import { engineLog } from '@aparte/bonaparte-shared';
import { useEffect, useId, useRef, useState } from 'react';
import { bridge } from '../bridge';
import { formatDuration } from '../format';
import type { Messages } from '../i18n/index';
import { FailureCard } from './FailureCard';

export interface EngineDiedCardProps {
  messages: Messages;
  locale: string;
  /** The memory to read again, in seconds; null before it is known. */
  rereadSeconds: number | null;
  busy: boolean;
  onRelaunch(): void;
}

export function EngineDiedCard({ messages, locale, rereadSeconds, busy, onRelaunch }: EngineDiedCardProps) {
  const words = messages.failures.engineDied;
  const [log, setLog] = useState<{ lines: string; exitCode: number | null } | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    let live = true;
    void bridge
      .invoke(engineLog, undefined)
      .then((read) => {
        if (live) setLog(read);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const code = log?.exitCode === null || log?.exitCode === undefined ? null : `0x${(log.exitCode >>> 0).toString(16).toUpperCase()}`;
  return (
    <>
      <FailureCard
        tone="error"
        context={words.context}
        title={words.title}
        headline={words.headline(code)}
        safeLabel={messages.failures.safe}
        safe={words.safe}
        lostLabel={messages.failures.lost}
        lost={rereadSeconds === null ? words.lostUnknown : words.lost(formatDuration(rereadSeconds, locale))}
        actions={[
          { label: words.relaunch, run: onRelaunch, busy },
          { label: words.log, run: () => setReading(true) },
        ]}
      />
      <EngineLogDialog messages={messages} open={reading} lines={log?.lines ?? ''} onClose={() => setReading(false)} />
    </>
  );
}

/** llama.cpp's last lines, as it wrote them: read, never interpreted. */
export function EngineLogDialog({ messages, open, lines, onClose }: { messages: Messages; open: boolean; lines: string; onClose(): void }) {
  const words = messages.failures.log;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="aparte-dialog engine-log" aria-labelledby={titleId} onClose={onClose}>
      <header className="aparte-dialog__header">
        <h2 id={titleId} className="aparte-dialog__title">
          {words.title}
        </h2>
      </header>
      <div className="aparte-dialog__body">
        {lines.trim() ? <pre className="engine-log__lines">{lines}</pre> : <p className="aparte-field-hint">{words.empty}</p>}
      </div>
      <footer className="aparte-dialog__footer">
        <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={onClose}>
          {words.close}
        </button>
      </footer>
    </dialog>
  );
}
