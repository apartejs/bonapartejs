import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ShellChoice {
  id: string;
  label: string;
}

/** Rythme de lecture : nerveux quand ça débite, économe au repos. */
const POLL_ACTIVE_MS = 30;
const POLL_IDLE_MS = 200;

const LABELS = {
  fr: {
    shell: 'Shell',
    degraded:
      'Terminal dégradé : le PTY natif n’a pas pu être chargé, les programmes plein écran ne fonctionneront pas.',
    exited: 'Le shell s’est terminé.',
    restart: 'Relancer',
    noShell: 'Aucun shell trouvé sur cette machine.',
    lost: (n: number) => `[… ${n} caractères perdus : sortie trop rapide …]`,
  },
  en: {
    shell: 'Shell',
    degraded:
      'Degraded terminal: the native PTY could not be loaded, full-screen programs will not work.',
    exited: 'The shell exited.',
    restart: 'Restart',
    noShell: 'No shell found on this machine.',
    lost: (n: number) => `[… ${n} characters lost: output too fast …]`,
  },
} as const;

/**
 * Terminal : xterm.js branché sur un vrai PTY.
 *
 * L'ancienne vue était un champ de commande et un `<div>` de sortie, avec les
 * séquences ANSI retirées côté Node — donc pas un terminal, une console de
 * log. Ici l'émulateur reçoit les octets BRUTS : couleurs, curseur, effacement
 * d'écran, programmes interactifs.
 *
 * Le shell se choisit parmi ceux réellement installés (PowerShell, Git Bash,
 * WSL…), comme dans VS Code : proposer un shell absent, c'est promettre un
 * terminal qui ne s'ouvrira pas.
 */
export default function TerminalView({ locale, projectRoot }: ToolingViewProps) {
  const t = LABELS[locale === 'en' ? 'en' : 'fr'];
  // Les vues de plugins passent par le pont typé de l'app, pas par une prop :
  // c'est le chemin unique renderer → moitié Node, et il se démonte avec le
  // plugin (cf. le plugin navigateur).
  const invoke = useCallback(
    (command: string, payload?: unknown) =>
      window.bonaparte.invokePlugin('terminal', command, payload),
    [],
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cursorRef = useRef(0);
  const [shells, setShells] = useState<ShellChoice[]>([]);
  const [shellId, setShellId] = useState<string | null>(null);
  const [mode, setMode] = useState<'pty' | 'basique' | null>(null);
  const [exited, setExited] = useState(false);

  /** Ouvre (ou réouvre) une session et pose le curseur de lecture. */
  const open = useCallback(
    async (id: string | null) => {
      const term = termRef.current;
      if (!term) return;
      term.reset();
      cursorRef.current = 0;
      setExited(false);

      const reply = (await invoke('open', {
        ...(projectRoot ? { cwd: projectRoot } : {}),
        ...(id ? { shellId: id } : {}),
        cols: term.cols,
        rows: term.rows,
      })) as {
        mode?: 'pty' | 'basique';
        shellId?: string;
        since?: number;
        data?: string;
        error?: string;
      };

      if (reply.error) {
        term.writeln(`\x1b[31m${reply.error}\x1b[0m`);
        return;
      }
      setMode(reply.mode ?? null);
      if (reply.shellId) setShellId(reply.shellId);
      if (reply.data) term.write(reply.data);
      cursorRef.current = (reply.since ?? 0) + (reply.data?.length ?? 0);
    },
    [invoke, projectRoot],
  );

  // Montage de l'émulateur : une seule fois, et démonté proprement — un
  // Terminal qui survit à sa vue garde des écouteurs et une frame de rendu.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily:
        'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      allowProposedApi: true,
      // Le terminal suit le thème de l'app : lire du texte clair sur fond
      // clair serait pire que pas de terminal.
      theme: { background: '#17141c', foreground: '#e8e4ee' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const onData = term.onData((data) => {
      void invoke('write', { data });
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        void invoke('resize', { cols: term.cols, rows: term.rows });
      } catch {
        /* le conteneur peut être masqué : rien à redimensionner */
      }
    });
    observer.observe(host);

    void (async () => {
      const reply = (await invoke('shells')) as { shells?: ShellChoice[] };
      setShells(reply.shells ?? []);
      await open(null);
    })();

    return () => {
      observer.disconnect();
      onData.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Volontairement hors des dépendances : `open` change avec projectRoot,
    // et remonter l'émulateur à chaque changement de dossier tuerait la
    // session du shell. L'ouverture initiale suffit ; changer de shell passe
    // par le sélecteur.
  }, [invoke]);

  // Lecture : un curseur d'octets, un rythme qui s'adapte au débit.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async (): Promise<void> => {
      if (!alive) return;
      const reply = (await invoke('read', { since: cursorRef.current })) as {
        data?: string;
        lost?: number;
        next?: number;
        exited?: boolean;
      };
      if (!alive) return;
      const chunk = reply.data ?? '';
      // De la sortie a été perdue (tampon élagué plus vite qu'on ne lit) : on
      // le DIT. Un trou muet dans un terminal ferait douter de tout le reste.
      if (reply.lost && reply.lost > 0) {
        termRef.current?.write(`
[33m${t.lost(reply.lost)}[0m
`);
      }
      if (chunk) {
        termRef.current?.write(chunk);
        cursorRef.current = reply.next ?? cursorRef.current + chunk.length;
      }
      if (reply.exited) setExited(true);
      timer = setTimeout(() => void tick(), chunk ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    };

    timer = setTimeout(() => void tick(), POLL_ACTIVE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [invoke]);

  return (
    <div className="pty-view">
      <div className="pty-bar">
        <label className="pty-shell">
          <span>{t.shell}</span>
          <select
            value={shellId ?? ''}
            disabled={shells.length === 0}
            onChange={(e) => void open(e.target.value)}
          >
            {shells.length === 0 ? (
              <option value="">{t.noShell}</option>
            ) : (
              shells.map((shell) => (
                <option key={shell.id} value={shell.id}>
                  {shell.label}
                </option>
              ))
            )}
          </select>
        </label>
        {exited && (
          <button type="button" onClick={() => void open(shellId)}>
            {t.restart}
          </button>
        )}
      </div>

      {mode === 'basique' && <p className="pty-warning">{t.degraded}</p>}
      {exited && <p className="pty-warning">{t.exited}</p>}

      <div className="pty-host" ref={hostRef} />
    </div>
  );
}
