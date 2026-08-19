import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ShellState {
  mode: 'pty' | 'basique' | null;
  lines: string[];
  exited?: boolean;
}

const LABELS = {
  fr: {
    title: 'Terminal',
    start: 'Ouvrir un shell',
    placeholder: 'commande…',
    degraded:
      'Mode simplifié : node-pty n’est pas chargeable ici, les programmes plein écran ne fonctionneront pas.',
    exited: 'Le shell s’est terminé.',
    restart: 'Relancer',
  },
  en: {
    title: 'Terminal',
    start: 'Open a shell',
    placeholder: 'command…',
    degraded:
      'Simplified mode: node-pty could not be loaded here, so full-screen programs will not work.',
    exited: 'The shell exited.',
    restart: 'Restart',
  },
} as const;

/**
 * Terminal — volontairement sobre : un défilement et une ligne de saisie.
 * Le mode réellement obtenu est annoncé, parce qu'un « terminal » qui ne sait
 * pas faire tourner vim doit le dire avant qu'on essaie.
 */
export default function TerminalView({ projectRoot, locale }: ToolingViewProps) {
  const labels = LABELS[locale] ?? LABELS.en;
  const [state, setState] = useState<ShellState | null>(null);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLPreElement>(null);

  const open = useCallback(async () => {
    setState(
      (await window.bonaparte.invokePlugin('terminal', 'open', {
        cwd: projectRoot ?? undefined,
      })) as ShellState,
    );
  }, [projectRoot]);

  useEffect(() => {
    if (!state) return;
    const timer = setInterval(() => {
      void window.bonaparte
        .invokePlugin('terminal', 'read')
        .then((next) => setState(next as ShellState));
    }, 500);
    return () => clearInterval(timer);
  }, [state !== null]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [state?.lines.length]);

  const send = useCallback(async () => {
    await window.bonaparte.invokePlugin('terminal', 'write', { data: `${input}\n` });
    setInput('');
  }, [input]);

  if (!state) {
    return (
      <div className="plugin-view">
        <h3 className="plugin-view-title">{labels.title}</h3>
        <button type="button" onClick={() => void open()}>
          {labels.start}
        </button>
      </div>
    );
  }

  return (
    <div className="plugin-view terminal-view">
      {state.mode === 'basique' && <p className="setting-warning">{labels.degraded}</p>}
      <pre className="terminal-scroll" ref={scrollRef}>
        {state.lines.join('\n')}
      </pre>
      {state.exited ? (
        <div className="terminal-input-row">
          <span className="setting-help">{labels.exited}</span>
          <button
            type="button"
            onClick={() => {
              setState(null);
              void open();
            }}
          >
            {labels.restart}
          </button>
        </div>
      ) : (
        <form
          className="terminal-input-row"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <span className="terminal-prompt">›</span>
          <input
            className="terminal-input"
            value={input}
            placeholder={labels.placeholder}
            onChange={(event) => setInput(event.target.value)}
          />
        </form>
      )}
    </div>
  );
}
