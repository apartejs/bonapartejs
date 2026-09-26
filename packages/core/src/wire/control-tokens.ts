/**
 * Text that does not come from the user or from us — a file the model
 * read, a web page, a command's output — must not be able to speak as a
 * role (security audit 07, C3). /completion tokenises special tokens in
 * the prompt text, so a file containing `<|im_end|><|im_start|>system`
 * would open a real system turn in the middle of a tool result.
 *
 * A zero-width space after the `<` breaks the special token apart: the
 * model still reads the words, the tokenizer no longer sees a role. Only
 * the shapes that matter are touched — `<|name|>` tokens and the tool
 * response wrapper — so `a <|> b` or `x < y || z` come through untouched.
 */

const ZWSP = '​';

const CONTROL = /<(\|[a-z_]+\|>|\/?tool_response>)/gi;

export function neutralizeControlTokens(text: string): string {
  return text.replace(CONTROL, `<${ZWSP}$1`);
}
