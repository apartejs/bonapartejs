/**
 * What llama.cpp reads again when a branch starts before a message (task
 * 7.1) — its rules mirrored, so that the cost is said before it is paid. No
 * HTTP route says it beforehand.
 *
 * Read in llama.cpp's server (tools/server/server-context.cpp, b11558) and
 * checked against the installed build by the smoke:
 *
 * - A model without a sliding window truncates its cache anywhere: a shorter
 *   prefix is kept as it is.
 * - A model with one (Gemma 4) keeps only the window's last tokens in those
 *   layers. A shorter prefix — and every first request after a restore, as a
 *   branch's is — resumes from the newest context checkpoint at or before it,
 *   reading again from there; without one, everything.
 * - A checkpoint is made only while a prompt is read: where the request's
 *   reading starts when it appends at most `4 + n_ubatch` (516) tokens, else
 *   516 tokens before its end, and 4 tokens before its end. The list keeps the
 *   oldest and the 30 newest.
 */

/** `4 + n_ubatch` (512, the server's default): a reading that appends more gets no checkpoint where it starts. */
export const CHECKPOINT_SEGMENT_MAX = 516;
/** The newest checkpoints a slot keeps (with its oldest), `--ctx-checkpoints` 32 by default. */
export const CHECKPOINTS_NEWEST_KEPT = 30;
/** What resuming from the checkpoint where the message's request began reads: the end of the answer before it, and one. */
const AT_THE_CHECKPOINT = 8;

export interface RereadFacts {
  /** The model's sliding window (GGUF); 0 without one. */
  slidingWindow: number;
  /** The tokens of the prefix kept: the prompt up to the message. */
  prefixTokens: number;
  /** What the message's first request appended to what the slot held, in tokens. */
  segmentTokens: number;
  /** The answer before the message, in tokens: read again when there is no checkpoint where the message began. */
  previousAnswerTokens: number;
  /** The checkpoints made since the message's request: up to two a request, one a saved state. */
  checkpointsSince: number;
}

/** The tokens of the prefix kept that llama.cpp will read again — at most; 0 when it keeps the whole prefix. */
export function rereadBeforeMessage(facts: RereadFacts): number {
  if (facts.slidingWindow <= 0) return 0;
  // The checkpoint where the message's request began was let go: from the oldest kept, about everything.
  if (facts.checkpointsSince > CHECKPOINTS_NEWEST_KEPT) return facts.prefixTokens;
  // Too long a message: no checkpoint where it began; the one before is where the answer before it started.
  if (facts.segmentTokens > CHECKPOINT_SEGMENT_MAX) return Math.min(facts.prefixTokens, facts.previousAnswerTokens + AT_THE_CHECKPOINT);
  return AT_THE_CHECKPOINT;
}
