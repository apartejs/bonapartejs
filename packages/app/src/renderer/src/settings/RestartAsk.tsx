/**
 * A setting that restarts the engine (task 7.4; the sub-agents in parallel,
 * task 8.3) says first what it costs (board « Coûts annoncés », 6): the
 * reload, the saved memories it makes to read again, a reply it would cut —
 * and, for sub-agents in parallel, the slot more and its video memory. It is
 * kept only on a choice: now, at the end of the reply, or later (the next
 * load). « Moteur et mémoire » and « Général » ask the same way.
 */

import { engineApplySettings, engineRestartCost, type EngineLaunchSettingsView, type RestartAnnouncementView } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import { formatBytes, formatDuration } from '../format';
import type { Messages } from '../i18n/index';

/** Asked of the window: stop the replies that run (« Maintenant »). */
export const STOP_REPLIES = 'bonaparte-stop-replies';

export type LaunchChange =
  | { nCtx: number }
  | { cacheType: EngineLaunchSettingsView['cacheType'] }
  | { subagents: EngineLaunchSettingsView['subagents'] }
  // « Tout sur la carte » (review 12).
  | { gpuLayers: 'all' };

export interface Asking {
  change: LaunchChange;
  cost: RestartAnnouncementView | null;
}

/** What a page that asks keeps: the change asked about and its cost, and a restart asked for the end of a reply. */
export function useRestartAsk(onKept: (kept: LaunchChange) => void) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [pending, setPending] = useState(false);
  // The engine changed: the restart asked for the end of the reply is under way.
  useEffect(
    () =>
      bridge.on((event) => {
        if (event.kind === 'engine') setPending(false);
      }),
    [],
  );
  /** Asks what this change costs; nothing is kept by asking. `null`: the value kept was chosen again. */
  const ask = (next: LaunchChange | null): void => {
    if (!next) {
      setAsking(null);
      return;
    }
    setAsking({ change: next, cost: null });
    void bridge
      .invoke(engineRestartCost, next)
      .then((cost) => setAsking((was) => (was && was.change === next ? { ...was, cost } : was)))
      .catch(() => undefined);
  };
  const keep = async (restart: boolean, cutting = false): Promise<void> => {
    if (!asking) return;
    // « Maintenant » under a reply: the window stops it, and the engine restarts once it has.
    if (cutting) window.dispatchEvent(new CustomEvent(STOP_REPLIES));
    const replyRunning = asking.cost?.replyRunning ?? false;
    await bridge.invoke(engineApplySettings, { changes: asking.change, restart }).catch(() => undefined);
    setAsking(null);
    setPending(restart && replyRunning && !cutting);
    onKept(asking.change);
  };
  return { asking, pending, ask, keep, cancel: () => setAsking(null) };
}

/** Below this, the video memory two slots take more is said as none (two caches of half the size). */
const ABOUT_NONE_BYTES = 32 * 1024 ** 2;

const nameOf = (change: LaunchChange): 'nCtx' | 'cacheType' | 'subagents' =>
  'nCtx' in change ? 'nCtx' : 'cacheType' in change ? 'cacheType' : 'subagents';

export interface RestartCardProps {
  messages: Messages;
  locale: string;
  asking: Asking | null;
  pending: boolean;
  keep(restart: boolean, cutting?: boolean): Promise<void>;
  cancel(): void;
}

export function RestartCard({ messages, locale, asking, pending, keep, cancel }: RestartCardProps) {
  const words = messages.settings.engine;
  if (!asking) {
    return pending ? (
      <p className="setting-section__hint" role="status">
        {words.launchPending}
      </p>
    ) : null;
  }
  const cost = asking.cost;
  const parallel = cost?.parallel;
  return (
    <div className="aparte-alert launch-restart" role="status">
      <div className="aparte-alert__body">
        <p className="aparte-alert__title">{words.launchRestartTitle(words.launchSettingNames[nameOf(asking.change)])}</p>
        {cost ? (
          <>
            <p className="aparte-alert__message">
              {cost.loaded ? words.launchRestartReload(formatDuration(cost.reloadSeconds, locale)) : words.launchNextLoad}
            </p>
            {parallel ? (
              <p className="launch-restart__detail">
                {parallel.vramBytesEach === null
                  ? words.launchParallelUnknown
                  : parallel.nCtxBefore !== undefined
                    ? // The automatic context steps down for two slots: the drop is said, and what comes more is the
                      // difference of the caches (review of C2).
                      words.launchParallelDrop(
                        words.launchContextValue(String(Math.round(parallel.nCtxBefore / 1024))),
                        words.launchContextValue(String(Math.round((parallel.nCtx ?? 0) / 1024))),
                        (parallel.vramBytesMore ?? 0) < ABOUT_NONE_BYTES
                          ? null
                          : formatBytes(parallel.vramBytesMore!, { locale, units: messages.units }),
                      )
                    : words.launchParallel(
                        formatBytes(parallel.vramBytesMore ?? parallel.vramBytesEach, { locale, units: messages.units }),
                        words.launchContextValue(String(Math.round((parallel.nCtx ?? 0) / 1024))),
                      )}
              </p>
            ) : null}
            {cost.memoriesLost > 0 ? <p className="launch-restart__detail">{words.launchMemories(cost.memoriesLost)}</p> : null}
            {cost.loaded && cost.replyRunning ? <p className="launch-restart__detail">{words.launchReply}</p> : null}
          </>
        ) : null}
        <div className="launch-restart__actions">
          {!cost ? null : !cost.loaded ? (
            <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={() => void keep(false)}>
              {words.launchSave}
            </button>
          ) : cost.replyRunning ? (
            <>
              <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={() => void keep(true)}>
                {words.launchAfterReply}
              </button>
              <button type="button" className="aparte-btn aparte-btn--outline" onClick={() => void keep(true, true)}>
                {words.launchNowCut}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="aparte-btn aparte-btn--primary aparte-btn--solid" onClick={() => void keep(true)}>
                {words.launchNow}
              </button>
              <button type="button" className="aparte-btn aparte-btn--outline" onClick={() => void keep(false)}>
                {words.launchLater}
              </button>
            </>
          )}
          <button type="button" className="aparte-btn aparte-btn--ghost" onClick={cancel}>
            {words.launchCancel}
          </button>
        </div>
      </div>
    </div>
  );
}
