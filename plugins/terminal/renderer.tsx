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
 * Acknowledgment batch size. Must stay <= the host's low watermark, or the
 * producer, once paused, would never resume.
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
 * Terminal colors, READ from the app's theme.
 *
 * xterm wants concrete values in JavaScript, not `var()`: so we resolve the
 * tokens by hand. Hardcoding them left a black rectangle in light theme — an
 * unreadable terminal is worse than no terminal at all.
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
 * Terminal: xterm.js wired to a real PTY.
 *
 * The old view was a command field and an output `<div>`, with ANSI
 * sequences stripped on the Node side — so not a terminal, a log console.
 * Here the emulator receives the RAW bytes: colors, cursor, screen clearing,
 * interactive programs.
 *
 * The shell is chosen among those actually installed (PowerShell, Git Bash,
 * WSL…), as in VS Code: offering a shell that isn't there is promising a
 * terminal that won't open.
 *
 * Data is PUSHED by the Node half, and this view ACKNOWLEDGES what it has
 * written. The acknowledgment happens in the `term.write` callback, i.e.
 * when xterm has actually parsed the bytes — not when they were received.
 * That's what makes the back-pressure honest: the producer stops because
 * the screen is behind, not because the network is.
 */
export default function TerminalView({
  locale,
  projectRoot,
  instanceId,
}: ToolingViewProps) {
  const t = LABELS[locale === 'en' ? 'en' : 'fr'];
  // Plugin views go through the app's typed bridge, not through a prop:
  // it's the single renderer → Node half path, and it tears down with the
  // plugin (cf. the browser plugin).
  //
  // Every command carries the `instanceId`: several terminals can be open
  // at once, and nothing should let the Node half believe they are one.
  const invoke = useCallback(
    (command: string, payload?: Record<string, unknown>) =>
      window.bonaparte.invokePlugin('terminal', command, { ...payload, instanceId }),
    [instanceId],
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [shells, setShells] = useState<ShellChoice[]>([]);
  const [shellId, setShellId] = useState<string | null>(null);
  const [mode, setMode] = useState<'pty' | 'basic' | null>(null);
  const [exited, setExited] = useState(false);

  /** Opens (or reopens) a session and places the read cursor. */
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
        mode?: 'pty' | 'basic';
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
      // Session already alive: we redisplay what scrolled by without the
      // view. The history is NOT acknowledged — it was never counted as pushed.
      if (reply.history) term.write(reply.history);
    },
    [invoke, projectRoot],
  );

  // Mounting the emulator: only once, and torn down cleanly — a Terminal
  // that outlives its view keeps listeners and a render frame around.
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

    // The theme changes live (attribute on <html>): since xterm COPIED the
    // colors at construction time, they must be given back to it. Without
    // this, switching to light leaves a dark terminal in the middle of a
    // light interface.
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
        /* the container may be hidden: nothing to resize */
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
      // We leave the tab without closing it: the shell must CONTINUE
      // (that's what's expected of a terminal) but stop pushing to a dead
      // view. Without this signal, back-pressure would pause the PTY, the
      // gap would never come back down, and the shell would stay frozen
      // on return.
      void invoke('detach');
    };
    // Deliberately left out of the dependencies: `open` changes with
    // projectRoot, and remounting the emulator on every folder change would
    // kill the shell session. The initial opening is enough; changing shell
    // goes through the selector.
  }, [invoke]);

  // Subscription to pushed data. We acknowledge in batches, so as not to
  // do an IPC round trip per byte — same logic as VS Code's
  // CharCountAckSize.
  useEffect(() => {
    let unacked = 0;
    const unsubscribe = window.bonaparte.onPluginEvent((message) => {
      const { pluginId, event, payload } = message;
      // The filter is on the INSTANCE: without it, two open terminals
      // would each display the other's output.
      if (pluginId !== 'terminal' || message.instanceId !== instanceId) return;
      if (event === 'exit') {
        setExited(true);
        return;
      }
      if (event !== 'data' || typeof payload !== 'string') return;
      const chunk = payload;
      // The acknowledgment comes from xterm's callback: it means
      // "displayed," not "received." Without this, we would restart the
      // producer too early.
      termRef.current?.write(chunk, () => {
        unacked += chunk.length;
        if (unacked >= ACK_SIZE) {
          window.bonaparte.ackPluginData('terminal', instanceId, unacked);
          unacked = 0;
        }
      });
    });
    return unsubscribe;
  }, [instanceId]);

  return (
    <div className="pty-view">
      <div className="pty-bar">
        <label className="pty-shell">
          <span>{t.shell}</span>
          <select
            className="aparte-field aparte-field--sm"
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
          <button
            type="button"
            className="aparte-btn aparte-btn--neutral aparte-btn--soft aparte-btn--sm"
            onClick={() => void open(shellId)}
          >
            {t.restart}
          </button>
        )}
      </div>

      {mode === 'basic' && (
        <div className="pty-warning aparte-alert aparte-alert--warning" role="status">
          <div className="aparte-alert__body">
            <p className="aparte-alert__message">{t.degraded}</p>
          </div>
        </div>
      )}
      {exited && (
        <div className="pty-warning aparte-alert aparte-alert--neutral" role="status">
          <div className="aparte-alert__body">
            <p className="aparte-alert__message">{t.exited}</p>
          </div>
        </div>
      )}

      <div className="pty-host" ref={hostRef} />
    </div>
  );
}
