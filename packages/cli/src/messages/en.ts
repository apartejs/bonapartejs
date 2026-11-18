import type { CliMessages } from './types.js';

const SOURCE = { configured: 'chosen in the configuration', managed: 'installed by bonaparte', path: 'found on this machine' } as const;

export const en: CliMessages = {
  units: { mb: 'MB', gb: 'GB' },
  help: (version) =>
    [
      `('.') bonaparte ${version}`,
      '',
      'Usage:',
      '  bonaparte            launches the app',
      '  bonaparte doctor     says what the machine has for the built-in engine',
      '  bonaparte --version  the version',
      '  bonaparte --help     this help',
    ].join('\n'),
  unknownCommand: (command) => `Unknown command: ${command}`,
  launch: {
    appNotBuilt: 'The app is not built here: run `pnpm build` in the repository, or install the published package.',
    electronMissing: 'Electron is not installed with this package: install it again (`npm install -g @aparte/bonaparte`).',
    downloadingElectron: 'First launch: downloading Electron, about 110 MB, once…',
    launched: 'bonaparte is starting.',
  },
  doctor: {
    title: 'bonaparte doctor',
    node: (version) => `Node ${version}`,
    nodeTooOld: (version, min) => `Node ${version}: Node ${min} or newer is needed`,
    llamaMissing: 'llama.cpp not found: neither llama-server nor llama answers. bonaparte can download it at the first launch.',
    llama: (command, build, source) => `llama.cpp ${build}, ${SOURCE[source]} (${command})`,
    llamaSilent: (command) => `The llama.cpp chosen in the configuration does not answer: ${command}`,
    llamaTooOld: (command, build, min) => `llama.cpp ${build} is too old: b${min} or newer is needed (${command})`,
    llamaUnknownBuild: (command, build) => `llama.cpp answers, its version cannot be read: “${build}” (${command})`,
    slots: (dir, free) => `Conversation memories: ${dir}${free ? ` · ${free} free` : ''}`,
    slotsLowDisk: (dir, free) => `Conversation memories: ${dir} · only ${free} free`,
    slotsNotWritable: (dir) => `Conversation memories: cannot write in ${dir}`,
    gpu: (memory) => `Graphics card: ${memory} of video memory`,
    gpuNone: 'No graphics card measured: the model will run on the processor, more slowly',
    allGood: 'Everything is ready for the built-in engine.',
    blocking: 'The built-in engine cannot run until what is marked ✗ is fixed.',
  },
};
