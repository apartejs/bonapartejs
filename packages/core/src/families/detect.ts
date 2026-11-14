/**
 * Which family a model belongs to, read in the chat template its GGUF
 * carries — the one thing that says how the model was taught to be spoken
 * to. The most specific marks are looked for first: a harmony template
 * (gpt-oss) also has `<|start|>`, a Llama 3 one `<|eot_id|>`.
 */

import type { FamilyId } from './types.js';

const MARKS: readonly (readonly [FamilyId, string])[] = [
  ['gpt-oss', '<|channel|>'],
  ['llama', '<|start_header_id|>'],
  ['gemma', '<start_of_turn>'],
  ['mistral', '[INST]'],
  ['qwen', '<|im_start|>'],
];

export function detectFamily(chatTemplate: string | undefined): FamilyId | null {
  if (!chatTemplate) return null;
  for (const [family, mark] of MARKS) if (chatTemplate.includes(mark)) return family;
  return null;
}

/**
 * Why the built-in engine cannot run a model, and what can: a service
 * (Ollama, LM Studio, another endpoint) speaks the model through its own
 * template.
 */
export class UnsupportedFamilyError extends Error {
  readonly suggestion = 'use-external-provider' as const;

  constructor(
    readonly code: 'unsupported-family' | 'no-chat-template',
    readonly family?: FamilyId,
  ) {
    super(
      code === 'no-chat-template'
        ? 'This model carries no chat template: the built-in engine cannot know how to speak to it.'
        : family
          ? `The built-in engine does not speak the ${family} family yet.`
          : 'The chat template of this model is not one the built-in engine knows.',
    );
    this.name = 'UnsupportedFamilyError';
  }
}
