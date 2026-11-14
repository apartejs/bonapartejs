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
  },
};
