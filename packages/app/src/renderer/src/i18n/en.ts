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
    llama: {
      found: (build) => `llama.cpp ${build}, found on this machine.`,
      installed: (build) => `llama.cpp ${build}, installed by bonaparte.`,
      configured: (build) => (build ? `llama.cpp ${build}, chosen in the configuration.` : 'llama.cpp, chosen in the configuration.'),
      none: 'llama.cpp is not on this machine.',
      upToDate: 'up to date',
      published: (build) => `${build} is published.`,
      keptUpToDate: 'bonaparte checks it and keeps it up to date, installing nothing without your click.',
      download: (build, size) => `Download ${build} · ${size}`,
      update: (size) => `Update · ${size}`,
      downloading: (build, done, total) => `Downloading ${build}… ${done} of ${total}`,
      progressLabel: 'Downloading llama.cpp',
      checkFailed: 'The new versions of llama.cpp could not be checked.',
      failed: {
        title: 'llama.cpp was not installed.',
        digest: 'The file received is not the one published: it was deleted, nothing was run.',
        failed: 'Here is what happened:',
      },
    },
  },
  conversations: {
    new: 'New conversation',
    list: 'Conversations',
  },
  steps: {
    'slot-wait': 'Waiting for the engine',
    restore: 'Restoring the memory',
    seed: 'Preparing the start of the conversation',
    reread: 'Reading the conversation again',
  },
  memory: {
    restoreTitle: (tokens) => `Memory saved: ${tokens} tokens`,
    restoreLine: (seconds, instead) => `Resumes in ~${seconds} instead of ~${instead} of re-reading.`,
    restoreSaved: (date, time, size) => `Saved on ${date} at ${time} · ${size} on disk`,
    rereadTitle: (tokens, duration) => `To re-read: ${tokens} tokens, ~${duration}`,
    rereadReason: {
      evicted: 'Its memory was let go to stay under the disk budget.',
      'not-saved': 'Its memory was not saved: the app closed first, or the save failed.',
      behind: 'Its memory predates its latest messages: what follows is read again.',
      'other-model': 'Its memory was made for another model.',
      'cache-types': 'Its memory was made with other cache settings.',
      'context-too-small': 'Its memory no longer fits the current context.',
      'engine-died': 'The engine stopped during the last answer.',
    },
    rereadEvicted: (date, budget) => `Its memory was let go on ${date} to stay under ${budget}.`,
    rereadContinue: 'Re-read and continue',
    estimated: '(estimated)',
    rereadProgress: (done, total) => `Read: ${done} of ${total} tokens`,
    rereadProgressLabel: 'Re-reading the conversation',
  },
  engineCard: {
    ready: 'Engine ready',
    line: (context) => `Ready · context ${context} · 1 slot`,
  },
  modes: { lecture: 'Lecture', repetition: 'Répétition', plume: 'Plume', impro: 'Impro' },
  approval: {
    region: 'Approval request',
    verbs: { edit: 'Edit', write: 'Write', run: 'Run', fetch: 'Open', other: 'Use' },
    question: '?',
    modeNote: {
      lecture: 'Lecture: nothing is written without a plan',
      repetition: 'Répétition: every write is asked',
      plume: 'Plume: commands are asked',
      impro: 'Impro: this file is always asked',
    },
    allow: 'Allow',
    allowAndPlume: 'Allow and switch to Plume',
    refuse: 'Refuse…',
    refuseConfirm: 'Refuse',
    instructionLabel: 'What it should do instead',
    instructionPlaceholder: 'Tell it what to do instead (optional)',
    hint: 'Enter allows · Escape refuses',
    fails: {
      missing: 'The file does not exist: the edit will fail.',
      notFound: 'The text to replace is not in the file: the edit will fail.',
      ambiguous: (times) => `The text to replace is there ${times} times: the edit will fail.`,
    },
  },
  tools: {
    labels: {
      read_file: { running: 'Reading', done: 'Read', name: 'Read' },
      list_files: { running: 'Listing', done: 'Listed', name: 'List' },
      search: { running: 'Searching', done: 'Searched', name: 'Search' },
      edit_file: { running: 'Editing', done: 'Edited', name: 'Edit' },
      write_file: { running: 'Writing', done: 'Wrote', name: 'Write' },
      run_command: { running: 'Running', done: 'Ran', name: 'Run' },
      web_fetch: { running: 'Opening', done: 'Opened', name: 'Open' },
    },
    lines: (count) => `${count.toLocaleString('en-US')} ${count === 1 ? 'line' : 'lines'}`,
    entries: (count) => (count === 0 ? 'empty' : `${count.toLocaleString('en-US')} ${count === 1 ? 'entry' : 'entries'}`),
    matches: (count, more) =>
      count === 0 ? 'no match' : `${more ? 'over ' : ''}${count.toLocaleString('en-US')} ${count === 1 ? 'match' : 'matches'}`,
    exitCode: (code) => `exit code ${code}`,
    timedOut: 'timed out',
    stopped: 'stopped',
    created: 'new file',
    waiting: 'Waiting for your approval',
  },
};
