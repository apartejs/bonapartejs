/**
 * What llama.cpp reads again when a branch starts before a message (task
 * 7.1): its rules, mirrored so that the cost is said before it is paid. A
 * model without a sliding window keeps any prefix. One with it resumes from
 * a context checkpoint — llama.cpp makes one where a request's reading
 * starts (when it appends at most 516 tokens) and keeps the 30 newest — or
 * reads everything again.
 */

import { describe, expect, it } from 'vitest';
import { rereadBeforeMessage } from './reread.js';

const base = { slidingWindow: 1024, prefixTokens: 9_000, segmentTokens: 40, previousAnswerTokens: 600, checkpointsSince: 6 };

describe('what going back before a message reads again', () => {
  it('nothing on a model without a sliding window: llama.cpp keeps any prefix', () => {
    expect(rereadBeforeMessage({ ...base, slidingWindow: 0, segmentTokens: 5_000, checkpointsSince: 200 })).toBe(0);
  });

  it('a few tokens when the message’s request left a checkpoint where it began, and it is still kept', () => {
    expect(rereadBeforeMessage(base)).toBeLessThanOrEqual(8);
  });

  it('the answer before it when the message was too long for a checkpoint where it began', () => {
    expect(rereadBeforeMessage({ ...base, segmentTokens: 517 })).toBe(600 + 8);
  });

  it('everything when the checkpoint was let go: more than llama.cpp keeps were made since', () => {
    expect(rereadBeforeMessage({ ...base, checkpointsSince: 31 })).toBe(9_000);
  });
});
