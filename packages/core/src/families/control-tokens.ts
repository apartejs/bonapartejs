/**
 * Text that does not come from us — a file the model read, a web page, a
 * command's output, a tool's description, the person's own message — must
 * not be able to speak as a role or open a tool call (security rule 5).
 * /completion tokenises the special tokens it finds in the prompt text, so a
 * file containing `<|im_end|><|im_start|>system` would open a real system
 * turn in the middle of a tool result.
 *
 * A zero-width space after the first character breaks the special token
 * apart: the model still reads the words, the tokenizer no longer sees a
 * token. Only the shapes that matter are touched — any `<|name|>` token, and
 * the control tokens of the family — so `a <|> b` or `x < y || z` come
 * through untouched.
 */

import type { FamilyLayer } from './types.js';

const ZWSP = '​';

/** The `<|name|>` shape every family uses for some of its tokens. */
const ANY_PIPE_TOKEN = /<(\|[a-z_]+\|>)/gi;

export function neutralizeControlTokens(text: string, family?: Pick<FamilyLayer, 'controlTokens'>): string {
  let safe = text.replace(ANY_PIPE_TOKEN, `<${ZWSP}$1`);
  for (const token of family?.controlTokens ?? []) {
    if (token.length < 2) continue;
    safe = safe.split(token).join(`${token[0]}${ZWSP}${token.slice(1)}`);
  }
  return safe;
}
