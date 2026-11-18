import type { CliMessages } from './types.js';

const SOURCE = { configured: 'choisi dans la configuration', managed: 'installé par bonaparte', path: 'trouvé sur cette machine' } as const;

export const fr: CliMessages = {
  units: { mb: 'Mo', gb: 'Go' },
  help: (version) =>
    [
      `('.') bonaparte ${version}`,
      '',
      'Utilisation :',
      '  bonaparte doctor     dit ce que la machine a pour le moteur intégré',
      '  bonaparte --version  la version',
      '  bonaparte --help     cette aide',
    ].join('\n'),
  unknownCommand: (command) => `Commande inconnue : ${command}`,
  doctor: {
    title: 'bonaparte doctor',
    node: (version) => `Node ${version}`,
    nodeTooOld: (version, min) => `Node ${version} : il faut Node ${min} ou plus récent`,
    llamaMissing: 'llama.cpp introuvable : ni llama-server ni llama ne répondent. bonaparte peut le télécharger au premier lancement.',
    llama: (command, build, source) => `llama.cpp ${build}, ${SOURCE[source]} (${command})`,
    llamaSilent: (command) => `llama.cpp choisi dans la configuration ne répond pas : ${command}`,
    llamaTooOld: (command, build, min) => `llama.cpp ${build} est trop ancien : il faut la b${min} ou plus récente (${command})`,
    llamaUnknownBuild: (command, build) => `llama.cpp répond, sa version ne se lit pas : « ${build} » (${command})`,
    slots: (dir, free) => `Mémoires des conversations : ${dir}${free ? ` · ${free} libres` : ''}`,
    slotsLowDisk: (dir, free) => `Mémoires des conversations : ${dir} · seulement ${free} libres`,
    slotsNotWritable: (dir) => `Mémoires des conversations : impossible d’écrire dans ${dir}`,
    gpu: (memory) => `Carte graphique : ${memory} de mémoire vidéo`,
    gpuNone: 'Carte graphique non mesurée : le modèle tournera sur le processeur, plus lentement',
    allGood: 'Tout est prêt pour le moteur intégré.',
    blocking: 'Le moteur intégré ne peut pas tourner tant que ce qui est marqué ✗ n’est pas réglé.',
  },
};
