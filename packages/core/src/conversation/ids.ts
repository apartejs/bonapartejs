/**
 * A conversation id is a NAME: it becomes a folder under `conversations/`,
 * a slot file, a checkpoint folder. From the renderer it arrives as a
 * string like any other — and `rm(join(dir, '../x'), { recursive: true })`
 * is a deleted home folder (adversarial review, 2026-09-26). Letters,
 * digits, `-` and `_`, starting with a letter or a digit: never `.`, `..`,
 * a separator or a drive.
 */

const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isConversationId(id: unknown): id is string {
  return typeof id === 'string' && CONVERSATION_ID.test(id);
}

export function assertConversationId(id: unknown): string {
  if (!isConversationId(id)) throw new Error(`Invalid conversation id: ${JSON.stringify(id)}`);
  return id;
}
