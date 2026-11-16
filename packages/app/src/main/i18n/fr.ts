import type { MainWords } from './types.js';

const plural = (count: number, one: string, many: string): string => `${count} ${count > 1 ? many : one}`;

export const fr: MainWords = {
  locale: 'fr',
  tray: {
    tooltip: 'bonaparte',
    open: 'Ouvrir bonaparte',
    quit: 'Quitter',
    quitWhat: 'arrête le moteur, rien ne se perd',
    waiting: (approvals, questions) =>
      [approvals > 0 ? plural(approvals, 'accord attendu', 'accords attendus') : '', questions > 0 ? plural(questions, 'question', 'questions') : '']
        .filter(Boolean)
        .join(' · '),
    nothingWaits: 'rien ne t’attend',
    waitsApproval: 'attend ton accord',
    waitsAnswer: 'attend ta réponse',
    untitled: 'Nouvelle conversation',
    engineReady: (vram) => (vram ? `prêt · ${vram} de mémoire vidéo` : 'prêt'),
    engineStarting: 'se charge…',
    engineAsleep: 'endormi · la mémoire des conversations est sur disque',
    engineStopped: 'arrêté',
    release: 'Libérer le modèle',
    releaseWhat: 'la mémoire des conversations reste sur disque',
    quiet: 'Ne pas déranger pendant 1 h',
    quietUntil: (time) => `Ne pas déranger · jusqu’à ${time}`,
    gib: (value) => `${value} Go`,
  },
  notify: {
    done: 'Tour fini',
    approval: 'Attend ton accord',
    question: 'Te pose une question',
    failed: 'En panne',
    untitled: 'Nouvelle conversation',
    doneBody: 'La réponse est prête.',
    questionBody: 'L’agent attend ta réponse.',
    failedBody: 'Le moteur s’est arrêté pendant la réponse. Rien n’est perdu : le journal est sauf.',
    subagent: (name) => `Sous-agent ${name}`,
    calls: {
      edit: (path) => `Modifier ${path}`,
      write: (path) => `Écrire ${path}`,
      run: (command) => `Lancer ${command}`,
      fetch: (url) => `Lire ${url}`,
      other: (name) => `Utiliser ${name}`,
    },
  },
  badge: {
    approval: 'bonaparte attend ton accord',
    question: 'bonaparte attend ta réponse',
    failed: 'bonaparte est en panne',
    done: (count) => (count > 1 ? `bonaparte a fini ${count} réponses` : 'bonaparte a fini une réponse'),
  },
};
