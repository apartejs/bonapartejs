/**
 * What llama.cpp is launched with, in « Moteur et mémoire » (task 7.4): the
 * context of each conversation and the K/V cache type — settings that
 * restart the engine —, and how long without work before the model is
 * unloaded. A setting that restarts the engine says first what it costs
 * (board « Coûts annoncés », 6): the reload, the saved memories it makes to
 * read again, a reply it would cut — and is kept only on a choice: now, at
 * the end of the reply, or later (the next load).
 */

import {
  engineApplySettings,
  engineRestartCost,
  engineSettingsGet,
  type EngineLaunchSettingsView,
  type RestartAnnouncementView,
} from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import { formatDuration } from '../format';
import type { Messages } from '../i18n/index';
import { Choice, Row } from './controls';

/** Asked of the window: stop the replies that run (« Maintenant »). */
export const STOP_REPLIES = 'bonaparte-stop-replies';

type LaunchChange = { nCtx: number } | { cacheType: EngineLaunchSettingsView['cacheType'] };

const CONTEXTS = [4096, 8192, 16_384, 32_768, 65_536];
const IDLE = [5, 15, 30, 60, 0];

export interface LaunchSettingsProps {
  messages: Messages;
  locale: string;
  idleMinutes: number;
  change(key: string, value: unknown): void;
  /** Something was kept: the page reads the engine again. */
  onKept(): void;
}

export function LaunchSettings({ messages, locale, idleMinutes, change, onKept }: LaunchSettingsProps) {
  const words = messages.settings.engine;
  const [kept, setKept] = useState<EngineLaunchSettingsView | null>(null);
  const [asking, setAsking] = useState<{ change: LaunchChange; cost: RestartAnnouncementView | null } | null>(null);
  const [pending, setPending] = useState(false);

  const read = (): void => {
    void bridge.invoke(engineSettingsGet, undefined).then(setKept).catch(() => undefined);
  };
  useEffect(read, []);
  // The engine changed: the restart asked for the end of the reply is under way.
  useEffect(
    () =>
      bridge.on((event) => {
        if (event.kind === 'engine') setPending(false);
      }),
    [],
  );

  if (!kept) return null;
  const shown = { ...kept, ...(asking?.change ?? {}) };
  const ask = (next: LaunchChange): void => {
    const same = 'nCtx' in next ? next.nCtx === kept.nCtx : next.cacheType === kept.cacheType;
    if (same) {
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
    read();
    onKept();
  };

  const contexts = CONTEXTS.includes(kept.nCtx) ? CONTEXTS : [...CONTEXTS, kept.nCtx].sort((a, b) => a - b);
  const cost = asking?.cost ?? null;
  const setting = asking ? words.launchSettingNames['nCtx' in asking.change ? 'nCtx' : 'cacheType'] : '';
  return (
    <div className="launch-settings">
      <Row
        label={words.launchContext}
        hint={words.launchContextHint}
        control={
          <Choice
            small
            label={words.launchContext}
            value={String(shown.nCtx)}
            options={contexts.map((size) => ({ value: String(size), label: words.launchContextValue(String(Math.round(size / 1024))) }))}
            onChange={(next) => ask({ nCtx: Number(next) })}
          />
        }
      />
      <Row
        label={words.launchCache}
        hint={words.launchCacheHint}
        control={
          <Choice
            small
            label={words.launchCache}
            value={shown.cacheType}
            options={(['f16', 'q8_0', 'q4_0'] as const).map((type) => ({ value: type, label: words.launchCacheTypes[type] }))}
            onChange={(next) => ask({ cacheType: next })}
          />
        }
      />
      {asking ? (
        <div className="aparte-alert launch-restart" role="status">
          <div className="aparte-alert__body">
            <p className="aparte-alert__title">{words.launchRestartTitle(setting)}</p>
            {cost ? (
              <>
                <p className="aparte-alert__message">
                  {cost.loaded ? words.launchRestartReload(formatDuration(cost.reloadSeconds, locale)) : words.launchNextLoad}
                </p>
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
              <button type="button" className="aparte-btn aparte-btn--ghost" onClick={() => setAsking(null)}>
                {words.launchCancel}
              </button>
            </div>
          </div>
        </div>
      ) : pending ? (
        <p className="setting-section__hint" role="status">
          {words.launchPending}
        </p>
      ) : null}
      <Row
        label={words.launchIdle}
        hint={words.launchIdleHint}
        control={
          <Choice
            small
            label={words.launchIdle}
            value={String(idleMinutes)}
            options={IDLE.map((minutes) => ({ value: String(minutes), label: minutes === 0 ? words.launchIdleNever : words.launchIdleMinutes(minutes) }))}
            onChange={(next) => change('idleUnloadMinutes', Number(next))}
          />
        }
      />
    </div>
  );
}
