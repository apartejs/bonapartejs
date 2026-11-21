/**
 * What « Toujours » remembered (audit 2026-11-21, D3): the app's rules in
 * « Réglages · Permissions », a project's on its page, a conversation's own in
 * « Réglages de la conversation… ». Each row says what it
 * lets pass without asking — « Lancer `pnpm test` », « Modifier `src/` et ce
 * qu'il contient », « Agir sur les pages de `http://localhost:5173` » — and
 * « Retirer » takes it back: that call is asked again.
 */

import { permissionsRevoke, permissionsRules, type RememberedRuleView } from '@aparte/bonaparte-shared';
import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../bridge';
import { rememberedInSettings } from '../chat/remember';
import type { Messages } from '../i18n/index';

export function RememberedRules({ messages, projectId, conversationId }: { messages: Messages; projectId: string | null; conversationId?: string }) {
  const words = messages.settings.permissions.remembered;
  const [rules, setRules] = useState<RememberedRuleView[] | null>(null);
  const read = useCallback(() => {
    void bridge
      .invoke(permissionsRules, { projectId, ...(conversationId ? { conversationId } : {}) })
      .then(setRules)
      .catch(() => setRules([]));
  }, [projectId, conversationId]);
  useEffect(read, [read]);
  if (rules === null) return null;
  if (rules.length === 0) return <p className="setting-section__hint remembered-rules__none">{words.none}</p>;
  return (
    <ul className="remembered-rules" aria-label={words.title}>
      {rules.map(({ key, rule }) => {
        const said = rememberedInSettings(rule, messages);
        const whole = [said.lead, said.subject, said.tail].filter(Boolean).join(' ');
        return (
          <li key={key} className="setting-row remembered-rule">
            <span className="setting-row__text">
              <span className="setting-row__label">
                {said.lead} <code>{said.subject}</code>
                {said.tail ? ` ${said.tail}` : null}
              </span>
            </span>
            <span className="setting-row__control">
              <button
                type="button"
                className="aparte-btn aparte-btn--outline aparte-btn--sm"
                aria-label={words.removeOne(whole)}
                onClick={() => void bridge.invoke(permissionsRevoke, { projectId, ...(conversationId ? { conversationId } : {}), key }).catch(() => undefined).then(read)}
              >
                {words.remove}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
