/**
 * What llama.cpp is launched with, in « Moteur et mémoire » (task 7.4): the
 * context of each conversation and the K/V cache type — settings that
 * restart the engine —, and how long without work before the model is
 * unloaded. A setting that restarts the engine says first what it costs
 * (board « Coûts annoncés », 6): the reload, the saved memories it makes to
 * read again, a reply it would cut — and is kept only on a choice: now, at
 * the end of the reply, or later (the next load).
 */

import { engineSettingsGet, type EngineLaunchSettingsView } from '@aparte/bonaparte-shared';
import { useEffect, useState } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Choice, Row } from './controls';
import { RestartCard, useRestartAsk } from './RestartAsk';

export { STOP_REPLIES } from './RestartAsk';

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
  const read = (): void => {
    void bridge.invoke(engineSettingsGet, undefined).then(setKept).catch(() => undefined);
  };
  useEffect(read, []);
  const restart = useRestartAsk(() => {
    read();
    onKept();
  });

  if (!kept) return null;
  const { asking } = restart;
  const shown = { ...kept, ...(asking?.change ?? {}) };

  const contexts = CONTEXTS.includes(kept.nCtx) ? CONTEXTS : [...CONTEXTS, kept.nCtx].sort((a, b) => a - b);
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
            onChange={(next) => restart.ask(Number(next) === kept.nCtx ? null : { nCtx: Number(next) })}
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
            onChange={(next) => restart.ask(next === kept.cacheType ? null : { cacheType: next })}
          />
        }
      />
      <RestartCard messages={messages} locale={locale} {...restart} />
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
