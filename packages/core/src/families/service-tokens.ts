/**
 * The control tokens a service's server may parse, whatever model it runs (audit 13.4): shared by the service's
 * turns and its system prompt.
 */

import { neutralizeControlTokens } from './control-tokens.js';
import { EVERY_FAMILY } from './index.js';
import type { FamilyLayer } from './types.js';

/**
 * What a service's server may parse as special, whatever model it runs: the families the app speaks, Mistral's
 * bracketed tokens, Llama 2's and DeepSeek's (audit 13.4, second pass). A model of yet another family keeps the
 * generic `<|name|>` shape `neutralizeControlTokens` always breaks.
 */
const SERVICE_TOKENS: Pick<FamilyLayer, 'controlTokens'> = {
  controlTokens: [
    ...EVERY_FAMILY.controlTokens,
    '[INST]',
    '[/INST]',
    '[SYSTEM_PROMPT]',
    '[/SYSTEM_PROMPT]',
    '[AVAILABLE_TOOLS]',
    '[/AVAILABLE_TOOLS]',
    '[TOOL_CALLS]',
    '[TOOL_RESULTS]',
    '[/TOOL_RESULTS]',
    '[THINK]',
    '[/THINK]',
    '<s>',
    '</s>',
  ],
};

/** A DeepSeek token: `<｜User｜>`, `<｜end▁of▁sentence｜>` — a full-width bar after the bracket. */
const FULL_WIDTH_TOKEN = /<(?=｜)/g;

/** Text from outside, its control tokens disarmed for any family the service's model may be (security rule 5). */
export const disarmForService = (text: string): string => neutralizeControlTokens(text, SERVICE_TOKENS).replace(FULL_WIDTH_TOKEN, '<​');
