/**
 * The mode channels: the mode a conversation runs in, set by the person,
 * the preview of a call it paused on, and what « Toujours autoriser » remembers. Glue: the core decides.
 */

import type { Core } from '@aparte/bonaparte-core';
import { modesGet, modesSet, permissionsOffer, permissionsRemember, permissionsRevoke, permissionsRules, ruleKey, toolsPreview } from '@aparte/bonaparte-shared';
import type { IpcRegistry } from './register.js';

export type ModeCore = Pick<Core, 'modeOf' | 'setMode' | 'previewCall' | 'remembered'>;

export function registerModeChannels(ipc: IpcRegistry, core: ModeCore): void {
  ipc.handle(modesGet, ({ id }) => core.modeOf(id));
  ipc.handle(modesSet, ({ id, mode }) => core.setMode(id, mode));
  ipc.handle(toolsPreview, ({ id, call }) => core.previewCall(id, call));
  // « Toujours autoriser » (audit D3): the core says what a rule is; the window names a call and a scope.
  ipc.handle(permissionsOffer, ({ id, call }) => core.remembered.offer(id, call));
  ipc.handle(permissionsRemember, ({ id, call, scope }) => core.remembered.remember(id, call, scope));
  ipc.handle(permissionsRules, async ({ projectId, conversationId }) =>
    (await core.remembered.rules(projectId, conversationId)).map((rule) => ({ key: ruleKey(rule), rule })),
  );
  // Taken back by its name: only a rule that is kept there.
  ipc.handle(permissionsRevoke, async ({ projectId, conversationId, key }) => {
    const rule = (await core.remembered.rules(projectId, conversationId)).find((kept) => ruleKey(kept) === key);
    if (rule) await core.remembered.revoke(projectId, rule, conversationId);
  });
}
