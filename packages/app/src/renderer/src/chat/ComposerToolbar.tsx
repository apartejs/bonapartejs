/**
 * The composer's toolbar (board « Conversation au travail », §8.1): the
 * mode, then — aparté's triggers, which take no room — « / » for the
 * commands and « @ » for a file of the project; the model the engine runs,
 * and the context gauge. aparté's approval command (`/approval`) is left
 * out: the mode switch is the one place the mode changes. « Joindre un
 * fichier » and the model's menu come with their tasks (7.4, 9.x).
 */

import { searchQuery, type EngineStateView, type PlayMode } from '@aparte/bonaparte-shared';
import { AparteContext, AparteUi } from '@aparte/react';
import '@aparte/plugin-triggers';
import type { AparteTrigger } from '@aparte/plugin-triggers';
import { useMemo, useRef } from 'react';
import { bridge } from '../bridge';
import type { Messages } from '../i18n/index';
import { Icon } from '../shell/icons';
import { ModeSwitch } from './ModeSwitch';

export interface ComposerToolbarProps {
  messages: Messages;
  mode: PlayMode;
  onMode(mode: PlayMode): void;
  engine: EngineStateView;
  /** Where « @ » looks: the open conversation's project, or the project a new one starts in. */
  scope(): { conversationId?: string; projectId?: string };
}

export function ComposerToolbar({ messages, mode, onMode, engine, scope }: ComposerToolbarProps) {
  const where = useRef(scope);
  where.current = scope;
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
      {engine.model ? (
        <>
          <span className="composer-model">
            <Icon name="engine" />
            {engine.model.name}
          </span>
          <AparteContext window={String(engine.model.nCtx)} variant="ring" />
        </>
      ) : null}
    </>
  );
}
