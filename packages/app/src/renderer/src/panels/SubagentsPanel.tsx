/**
 * The « Sous-agents » pane (board « Une conversation avec des sous-agents au
 * travail », task 8.2). At its top, where they stand: « 3 sous-agents · 1
 * fini, 1 en cours, 1 en file » — aparté draws no such summary in the reply
 * (apartejs/aparte#247). Then one row per sub-agent: its state, its name and
 * its mission, its calls and its time; a row opens it below — what it was
 * given, its mission, its own thread (aparté's `<aparte-subagent-view>`, which
 * reads the chat by its id), what it returned. Its work stays there: only its
 * result went back to the conversation.
 */

import '@aparte/plugin-subagents';
import { subagentViewElement } from '@aparte/plugin-subagents';
import { createAparteElement } from '@aparte/react';
import { countOf, type SubagentRow } from '../aparte/subagents';
import type { Messages } from '../i18n/index';

const SubagentView = createAparteElement(subagentViewElement);

export interface SubagentsPanelProps {
  messages: Messages;
  /** The chat shown: the view reads the sub-agent's thread in it, by its id. */
  chatId: string | null;
  rows: readonly SubagentRow[];
  /** The sub-agent opened below the list. */
  selected: string | null;
  onSelect(agentId: string): void;
}

export function SubagentsPanel({ messages, chatId, rows, selected, onSelect }: SubagentsPanelProps) {
  const words = messages.subagentsPane;
  if (rows.length === 0) return <p className="subagents-pane__none">{words.none}</p>;
  const open = rows.find((row) => row.agentId === selected) ?? null;
  return (
    <div className="subagents-pane">
      <p className="subagents-pane__summary" aria-live="polite">
        {words.summary(countOf(rows))}
      </p>
      <ul className="subagents-pane__list" aria-label={words.list}>
        {rows.map((row) => (
          <li key={row.agentId}>
            <button
              type="button"
              className="subagents-pane__row"
              aria-pressed={row.agentId === selected}
              data-state={row.state}
              onClick={() => onSelect(row.agentId)}
            >
              <span className="subagents-pane__state" data-state={row.state} role="img" aria-label={words.states[row.state]} />
              <span className="subagents-pane__what">
                <span className="subagents-pane__name">{row.name}</span>
                <span className="subagents-pane__mission">{row.mission}</span>
              </span>
              <span className="subagents-pane__meta">{row.state === 'queued' ? words.notYet : words.meta(row.calls, row.seconds)}</span>
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <section className="subagents-pane__open" aria-label={open.name}>
          <header className="subagents-pane__head">
            <span className="subagents-pane__title">{open.name}</span>
            <span className="aparte-badge subagents-pane__pill" data-state={open.state}>
              {words.states[open.state]}
            </span>
            <span className="subagents-pane__given">{words.given(open.tools)}</span>
          </header>
          {open.mission ? (
            <p className="subagents-pane__box">
              <strong>{words.mission}</strong>
              <span className="subagents-pane__mission-text">{open.mission}</span>
            </p>
          ) : null}
          {chatId ? <SubagentView className="subagents-pane__thread" for={chatId} message-id={open.messageId} agent-id={open.agentId} /> : null}
          {open.result ? (
            <div className="subagents-pane__box subagents-pane__result">
              <strong>{words.result}</strong>
              <p>{open.result}</p>
            </div>
          ) : null}
          <p className="subagents-pane__note">{words.note}</p>
        </section>
      ) : null}
    </div>
  );
}
