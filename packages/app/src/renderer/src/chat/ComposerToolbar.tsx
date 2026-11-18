/**
 * The composer's toolbar (board « Conversation au travail », §8.1): the
 * mode, then — aparté's triggers, which take no room — « / » for the
 * commands and « @ » for a file of the project; the model, in aparté's
 * model selector (task 7.4: picking another opens the dialog that says what
 * it costs — the selector only tells the pick, it writes nothing), and the
 * context gauge. aparté's approval command (`/approval`) is left out: the
 * mode switch is the one place the mode changes. « Joindre un fichier »
 * comes with its task (9.x).
 */

import { searchQuery, type EngineStateView, type PlayMode } from '@aparte/bonaparte-shared';
import { aparteGlobalConfig } from '@aparte/core';
import { AparteContext, AparteUi, createAparteElement } from '@aparte/react';
import { modelSelectorElement, type AparteModelSelector } from '@aparte/plugin-model-selector';
import '@aparte/plugin-triggers';
import type { AparteTrigger } from '@aparte/plugin-triggers';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { ENGINE_PROVIDER } from '../aparte/model-catalogue';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';
import { ModeSwitch } from './ModeSwitch';

const ModelSelector = createAparteElement(modelSelectorElement);

export interface ComposerToolbarProps {
  messages: Messages;
  mode: PlayMode;
  onMode(mode: PlayMode): void;
  engine: EngineStateView;
  /** Where « @ » looks: the open conversation's project, or the project a new one starts in. */
  scope(): { conversationId?: string; projectId?: string };
  /** Another model picked: `revert` shows the one that runs again (« Annuler »). */
  onPickModel(path: string, name: string, revert: () => void): void;
  /** Set to what opens the picker (« Un autre modèle… », the engine unloaded). */
  opener?: MutableRefObject<(() => void) | null>;
  /**
   * A model of a service picked (task 9.3) — or, `provider` null, the built-in engine's own model picked back:
   * `revert` shows the choice before it again.
   */
  onPickService?(provider: string | null, model: string, revert: () => void): void;
  /** The conversation shown runs on a service: its model is the one shown, and no gauge is drawn. */
  service?: { id: string; model: string } | null;
}

export function ComposerToolbar({ messages, mode, onMode, engine, scope, onPickModel, opener, onPickService, service }: ComposerToolbarProps) {
  const where = useRef(scope);
  where.current = scope;
  const selector = useRef<HTMLElement>(null);
  // The model that runs — else the one a load would bring back, which the picker shows chosen. Read when the
  // picker speaks, never from an older render: during a load it echoes the config as it follows the engine.
  const running = engine.model?.path ?? engine.resume?.path;
  const runningNow = useRef(running);
  runningNow.current = running;
  // What the picker shows follows the conversation shown: its service's model, else the engine's (a `picked: false`
  // change, which asks nothing).
  const shownService = service ? `${service.id}\u0000${service.model}` : null;
  const servicePicks = useRef(onPickService);
  servicePicks.current = onPickService;
  useEffect(() => {
    const picker = selector.current as AparteModelSelector | null;
    if (!picker) return;
    if (service) picker.setSelection(service.id, service.model);
    else if (runningNow.current) picker.setSelection(ENGINE_PROVIDER, runningNow.current);
  }, [shownService]);
  useEffect(() => {
    if (!opener) return;
    opener.current = () => selector.current?.querySelector<HTMLElement>('[role="combobox"], [role="button"]')?.click();
    return () => {
      opener.current = null;
    };
  }, [opener]);
  const triggers = useMemo<AparteTrigger[]>(
    () => [
      { char: '/', at: 'message', commands: { exclude: ['approval'] } },
      {
        char: '@',
        kind: 'file',
        // The core found them by their name: aparté's own match reads a label's start (`src/…`).
        match: () => true,
        items: async (query) => {
          if (query.trim() === '') return [];
          const found = await bridge.invoke(searchQuery, { query, ...where.current() });
          return found.files.map((file) => ({
            id: file.path,
            label: file.path,
            insert: { label: file.path, text: file.path, kind: 'file', data: { path: file.path } },
          }));
        },
      },
    ],
    [],
  );
  // One object while the triggers stay: <AparteUi> gives the element its props again for a new
  // object (since aparté 1.10, re-setting the same triggers keeps an open list open).
  const elementProps = useMemo(() => ({ triggers }), [triggers]);
  return (
    <>
      <ModeSwitch mode={mode} messages={messages} onChange={onMode} />
      <AparteUi name="aparte-triggers" props={elementProps} />
      {engine.mode === 'remote' ? (
        // A server that already runs serves its own model: nothing to choose, its name said.
        <span className="composer-model">
          <Icon name="engine" />
          {engine.model?.name}
        </span>
      ) : (
        <ModelSelector
          ref={selector}
          className="composer-model-picker"
          details=""
          placeholder={messages.modelSwitch.picker}
          aria-label={messages.modelSwitch.picker}
          onModelChange={(detail) => {
            // Only the person's pick, in the list or through « /model » (`picked`, aparté 1.12.2, apartejs/aparte#244 and
            // apartejs/aparte#255): a revert, the config following the engine, or the model that runs chosen again asks nothing.
            if (!detail.picked || !detail.modelId) return;
            const back = (): void => {
              const picker = selector.current as AparteModelSelector | null;
              if (service) picker?.setSelection(service.id, service.model);
              else if (runningNow.current) picker?.setSelection(ENGINE_PROVIDER, runningNow.current);
            };
            // A service's model (task 9.3), or the engine's own picked back after one.
            if (detail.providerId && detail.providerId !== ENGINE_PROVIDER) {
              servicePicks.current?.(detail.providerId, detail.modelId, back);
              return;
            }
            if (detail.modelId === runningNow.current) {
              servicePicks.current?.(null, detail.modelId, back);
              return;
            }
            const listed = aparteGlobalConfig.getAIProvider(ENGINE_PROVIDER)?.getModels() ?? [];
            const name = listed.find((model) => model.id === detail.modelId)?.name ?? detail.modelId;
            onPickModel(detail.modelId, name, () => {
              const back = runningNow.current;
              if (back) (selector.current as AparteModelSelector | null)?.setSelection(ENGINE_PROVIDER, back);
            });
          }}
        />
      )}
      {/* A service does not say its context: no gauge rather than a wrong one (task 9.3). */}
      {engine.model && !service ? <AparteContext window={String(engine.model.nCtx)} variant="ring" /> : null}
    </>
  );
}
