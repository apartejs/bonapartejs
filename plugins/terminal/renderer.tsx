import type { ToolingViewProps } from '@aparte/bonaparte-plugin-sdk';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ShellChoice {
  id: string;
  label: string;
}

/**
 * Paquet d'acquittement. Doit rester <= au seuil bas de l'hôte, sinon le
 * producteur, mis en pause, ne repartirait jamais.
 */
const ACK_SIZE = 5_000;

const LABELS = {
  fr: {
    shell: 'Shell',
    degraded:
      'Terminal dégradé : le PTY natif n’a pas pu être chargé, les programmes plein écran ne fonctionneront pas.',
    exited: 'Le shell s’est terminé.',
    restart: 'Relancer',
    noShell: 'Aucun shell trouvé sur cette machine.',
  },
  en: {
    shell: 'Shell',
    degraded:
      'Degraded terminal: the native PTY could not be loaded, full-screen programs will not work.',
    exited: 'The shell exited.',
    restart: 'Restart',
    noShell: 'No shell found on this machine.',
  },
} as const;

/**
 * Couleurs du terminal, LUES dans le thème de l'app.
 *
 * xterm veut des valeurs concrètes en JavaScript, pas des `var()` : on résout
 * donc les tokens à la main. Les coder en dur laissait un rectangle noir en
 * thème clair — un terminal illisible est pire qu'un terminal absent.
 */
function readTheme(): { background: string; foreground: string } {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    background: token('--aparte-bg', '#17141c'),
    foreground: token('--aparte-text', '#e8e4ee'),
  };
}

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
 *
 * Les données sont POUSSÉES par la moitié Node, et cette vue ACQUITTE ce
 * qu'elle a écrit. L'acquittement se fait dans le callback de `term.write`,
 * c'est-à-dire quand xterm a réellement analysé les octets — pas quand on les a
 * reçus. C'est ce qui rend la contre-pression honnête : le producteur s'arrête
 * parce que l'écran est en retard, pas parce que le réseau l'est.
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
      setExited(false);

      const reply = (await invoke('open', {
        ...(projectRoot ? { cwd: projectRoot } : {}),
        ...(id ? { shellId: id } : {}),
        cols: term.cols,
        rows: term.rows,
      })) as {
        mode?: 'pty' | 'basique';
        shellId?: string;
        history?: string;
        error?: string;
      };

      if (reply.error) {
        term.writeln(`\x1b[31m${reply.error}\x1b[0m`);
        return;
      }
      setMode(reply.mode ?? null);
      if (reply.shellId) setShellId(reply.shellId);
      // Session déjà vivante : on réaffiche ce qui a défilé sans la vue.
      // L'historique n'est PAS acquitté — il n'a jamais été compté comme poussé.
      if (reply.history) term.write(reply.history);
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
      theme: readTheme(),
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

    // Le thème se change à chaud (attribut sur <html>) : xterm ayant COPIÉ les
    // couleurs à sa construction, il faut les lui redonner. Sans ça, basculer
    // en clair laisse un terminal sombre au milieu d'une interface claire.
    const themeWatcher = new MutationObserver(() => {
      term.options.theme = readTheme();
    });
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-aparte-theme'],
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
      themeWatcher.disconnect();
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

  // Abonnement aux données poussées. On acquitte par paquets, pour ne pas
  // faire un aller-retour IPC par octet — même logique que le CharCountAckSize
  // de VS Code.
  useEffect(() => {
    let unacked = 0;
    const unsubscribe = window.bonaparte.onPluginEvent(({ pluginId, event, payload }) => {
      if (pluginId !== 'terminal') return;
      if (event === 'exit') {
        setExited(true);
        return;
      }
      if (event !== 'data' || typeof payload !== 'string') return;
      const chunk = payload;
      // L'acquittement part du callback de xterm : il signifie « affiché »,
      // pas « reçu ». Sans ça, on relancerait le producteur trop tôt.
      termRef.current?.write(chunk, () => {
        unacked += chunk.length;
        if (unacked >= ACK_SIZE) {
          window.bonaparte.ackPluginData('terminal', unacked);
          unacked = 0;
        }
      });
    });
    return unsubscribe;
  }, []);

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
