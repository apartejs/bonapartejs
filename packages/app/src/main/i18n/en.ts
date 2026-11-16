import type { MainWords } from './types.js';

const plural = (count: number, one: string, many: string): string => `${count} ${count > 1 ? many : one}`;

export const en: MainWords = {
  locale: 'en',
  tray: {
    tooltip: 'bonaparte',
    open: 'Open bonaparte',
    quit: 'Quit',
    quitWhat: 'stops the engine, nothing is lost',
    waiting: (approvals, questions) =>
      [approvals > 0 ? plural(approvals, 'approval waiting', 'approvals waiting') : '', questions > 0 ? plural(questions, 'question', 'questions') : '']
        .filter(Boolean)
        .join(' · '),
    nothingWaits: 'nothing waits for you',
    waitsApproval: 'waits for your approval',
    waitsAnswer: 'waits for your answer',
    untitled: 'New conversation',
    engineReady: (vram) => (vram ? `ready · ${vram} of video memory` : 'ready'),
    engineStarting: 'loading…',
    engineAsleep: 'asleep · the conversations’ memory is on disk',
    engineStopped: 'stopped',
    release: 'Release the model',
    releaseWhat: 'the conversations’ memory stays on disk',
    quiet: 'Do not disturb for 1 h',
    quietUntil: (time) => `Do not disturb · until ${time}`,
    gib: (value) => `${value} GB`,
  },
  notify: {
    done: 'Turn done',
    approval: 'Waits for your approval',
    question: 'Has a question for you',
    failed: 'Failed',
    untitled: 'New conversation',
    doneBody: 'The answer is ready.',
    questionBody: 'The agent waits for your answer.',
    failedBody: 'The engine stopped during the answer. Nothing is lost: the journal is safe.',
    subagent: (name) => `Sub-agent ${name}`,
    calls: {
      edit: (path) => `Edit ${path}`,
      write: (path) => `Write ${path}`,
      run: (command) => `Run ${command}`,
      fetch: (url) => `Read ${url}`,
      other: (name) => `Use ${name}`,
    },
  },
  badge: {
    approval: 'bonaparte waits for your approval',
    question: 'bonaparte waits for your answer',
    failed: 'bonaparte has failed',
    done: (count) => (count > 1 ? `bonaparte finished ${count} replies` : 'bonaparte finished a reply'),
  },
};
