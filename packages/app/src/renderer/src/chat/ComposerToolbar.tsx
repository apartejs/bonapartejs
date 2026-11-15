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
import { useMemo, useRef } from 'react';
import { ENGINE_PROVIDER } from '../aparte/model-catalogue';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
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
}

export function ComposerToolbar({ messages, mode, onMode, engine, scope, onPickModel }: ComposerToolbarProps) {
  const where = useRef(scope);
  where.current = scope;
  const selector = useRef<HTMLElement>(null);
  const running = engine.model?.path;
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
      <ModelSelector
        ref={selector}
        className="composer-model-picker"
        details=""
        placeholder={messages.modelSwitch.picker}
        aria-label={messages.modelSwitch.picker}
        onModelChange={(detail) => {
          // The model that runs shown again (a revert, the config following the engine) is no pick.
          if (!detail.modelId || detail.modelId === running) return;
          const listed = aparteGlobalConfig.getAIProvider(ENGINE_PROVIDER)?.getModels() ?? [];
          const name = listed.find((model) => model.id === detail.modelId)?.name ?? detail.modelId;
          onPickModel(detail.modelId, name, () => {
            if (running) (selector.current as AparteModelSelector | null)?.setSelection(ENGINE_PROVIDER, running);
          });
        }}
      />
      {engine.model ? <AparteContext window={String(engine.model.nCtx)} variant="ring" /> : null}
    </>
  );
}
