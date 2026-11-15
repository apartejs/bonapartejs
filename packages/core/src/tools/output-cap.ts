/**
 * A tool's output is cut to a quarter of the context, counted at three
 * characters a token, and never more than 30,000 characters (6,144 for 8,192
 * tokens, 24,576 for 32,768): a long output must not fill the conversation.
 * The model is told what it does not see.
 */

const MOST = 30_000;

export function maxToolOutputChars(nCtx: number): number {
  return Math.min(MOST, Math.floor(nCtx / 4) * 3);
}

export function capToolOutput(content: string, nCtx: number): string {
  const max = maxToolOutputChars(nCtx);
  if (content.length <= max) return content;
  const left = content.length - max;
  return `${content.slice(0, max)}\n[The output was cut: ${left.toLocaleString('en-US')} more characters were not shown.]`;
}
