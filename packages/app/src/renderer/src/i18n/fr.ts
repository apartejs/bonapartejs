import type { Messages } from './types.js';

export const fr: Messages = {
  app: {
    name: 'bonaparte',
  },
  units: { b: 'o', kb: 'Ko', mb: 'Mo', gb: 'Go' },
  families: { qwen: 'Qwen', gemma: 'Gemma', llama: 'Llama', mistral: 'Mistral', 'gpt-oss': 'gpt-oss' },
  composer: {
    placeholder: 'Réponds, ou demande autre chose…',
  },
  chat: {
    empty: 'Pose une question pour commencer.',
  },
  engineSetup: {
    title: 'Préparons le moteur',
    lede: 'Rien n’est chargé ni envoyé avant ton clic.',
    modelsLegend: 'Modèles trouvés',
    searching: 'Recherche des modèles…',
    perToken: (size) => `${size} par jeton`,
    verdict: { fits: 'tient', tight: 'juste', 'too-big': 'trop gros', unknown: 'non mesuré' },
    problem: {
      'unsupported-family': 'Le moteur intégré ne parle pas cette famille de modèles : passe par un service existant.',
      'no-chat-template': 'Ce fichier n’a pas de gabarit de conversation : passe par un service existant.',
      unreadable: 'Son en-tête ne se lit pas : le fichier est peut-être incomplet.',
    },
    announce: ({ seconds, estimated, vram, gpu }) =>
      `Chargement ~${seconds} s${estimated ? ' (estimé)' : ''} · ${vram} de mémoire vidéo${
        gpu ? ` sur ${gpu}` : ' (carte non mesurée)'
      }`,
    start: 'Démarrer',
    starting: 'Chargement…',
    empty: {
      title: 'Aucun modèle trouvé',
      body: 'bonaparte cherche dans le dossier de LM Studio et dans le cache de Hugging Face.',
    },
    failed: {
      title: 'Le moteur n’a pas démarré.',
      reason: {
        'not-listed': 'Ce fichier n’est plus parmi les modèles trouvés.',
        'unsupported-family': 'Le moteur intégré ne parle pas cette famille de modèles.',
        'no-chat-template': 'Ce fichier n’a pas de gabarit de conversation.',
        failed: 'Voici ce qu’a dit llama.cpp :',
      },
    },
    llama: {
      found: (build) => `llama.cpp ${build}, trouvé sur cette machine.`,
      installed: (build) => `llama.cpp ${build}, installé par bonaparte.`,
      configured: (build) => (build ? `llama.cpp ${build}, choisi dans la configuration.` : 'llama.cpp, choisi dans la configuration.'),
      none: 'llama.cpp n’est pas sur cette machine.',
      upToDate: 'à jour',
      published: (build) => `La ${build} est publiée.`,
      keptUpToDate: 'bonaparte la vérifie et la tient à jour, sans rien installer sans ton clic.',
      download: (build, size) => `Télécharger la ${build} · ${size}`,
      update: (size) => `Mettre à jour · ${size}`,
      downloading: (build, done, total) => `Téléchargement de la ${build}… ${done} sur ${total}`,
      progressLabel: 'Téléchargement de llama.cpp',
      checkFailed: 'Impossible de vérifier les nouvelles versions de llama.cpp.',
      failed: {
        title: 'llama.cpp n’a pas été installé.',
        digest: 'Le fichier reçu n’est pas celui qui est publié : il a été supprimé, rien n’a été lancé.',
        failed: 'Voici ce qui s’est passé :',
      },
    },
  },
  conversations: {
    new: 'Nouvelle conversation',
    list: 'Conversations',
  },
  steps: {
    'slot-wait': 'Attend le moteur',
    restore: 'Reprend la mémoire',
    seed: 'Prépare le début de la conversation',
    reread: 'Relit la conversation',
  },
  memory: {
    restoreTitle: (tokens) => `Mémoire sauvée : ${tokens} jetons`,
    restoreLine: (seconds, instead) => `Reprise en ~${seconds} au lieu de ~${instead} de relecture.`,
    restoreSaved: (date, time, size) => `Sauvée le ${date} à ${time} · ${size} sur disque`,
    rereadTitle: (tokens, duration) => `À relire : ${tokens} jetons, ~${duration}`,
    rereadReason: {
      evicted: 'Sa mémoire a été libérée pour rester sous le budget disque.',
      'other-model': 'Sa mémoire a été faite pour un autre modèle.',
      'cache-types': 'Sa mémoire a été faite avec d’autres réglages du cache.',
      'context-too-small': 'Sa mémoire ne tient plus dans le contexte actuel.',
      'engine-died': 'Le moteur s’est arrêté pendant la dernière réponse.',
    },
    rereadContinue: 'Relire et continuer',
    estimated: '(estimé)',
    rereadProgress: (done, total) => `Relu : ${done} sur ${total} jetons`,
    rereadProgressLabel: 'Relecture de la conversation',
  },
  engineCard: {
    ready: 'Moteur prêt',
    line: (context) => `Prêt · contexte ${context} · 1 slot`,
  },
};
