import type { Messages } from './types.js';

export const en: Messages = {
  app: {
    name: 'bonaparte',
  },
  units: { b: 'B', kb: 'KB', mb: 'MB', gb: 'GB' },
  families: { qwen: 'Qwen', gemma: 'Gemma', llama: 'Llama', mistral: 'Mistral', 'gpt-oss': 'gpt-oss' },
  composer: {
    placeholder: 'Reply, or ask something else…',
  },
  chat: {
    empty: 'Ask something to get started.',
  },
  engineSetup: {
    title: 'Let’s set up the engine',
    lede: 'Nothing is loaded or sent before you click.',
    modelsLegend: 'Models found',
    searching: 'Looking for models…',
    perToken: (size) => `${size} per token`,
    verdict: { fits: 'fits', tight: 'tight', 'too-big': 'too big', unknown: 'not measured' },
    problem: {
      'unsupported-family': 'The built-in engine does not speak this family of models: use an existing service.',
      'no-chat-template': 'This file has no chat template: use an existing service.',
      unreadable: 'Its header cannot be read: the file may be incomplete.',
    },
    announce: ({ seconds, estimated, vram, gpu }) =>
      `Loading ~${seconds} s${estimated ? ' (estimated)' : ''} · ${vram} of video memory${
        gpu ? ` out of ${gpu}` : ' (card not measured)'
      }`,
    start: 'Start',
    starting: 'Loading…',
    empty: {
      title: 'No model found',
      body: 'bonaparte looks in the LM Studio folder and in the Hugging Face cache.',
    },
    failed: {
      title: 'The engine did not start.',
      reason: {
        'not-listed': 'This file is no longer among the models found.',
        'unsupported-family': 'The built-in engine does not speak this family of models.',
        'no-chat-template': 'This file has no chat template.',
        failed: 'Here is what llama.cpp said:',
      },
    },
  },
};
