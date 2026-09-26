/**
 * Catalog of the harness's settings.
 *
 * The dividing line is structural, not cosmetic:
 *
 * - **Launch** (`scopes: ['global']`): these parameters go into the KV
 *   manifest. Letting them vary per conversation would make the manifest
 *   diverge from the server actually launched — and a restore refused (at
 *   best) or wrongly accepted (at worst). Changing them invalidates saved
 *   states, and the interface must say so beforehand, not after.
 * - **Sampling** (`global` + `conversation`): live, with no effect on the
 *   prompt's prefix, hence no effect on the cache. That's what makes it
 *   legitimate to tune it conversation by conversation.
 *
 * Labels and descriptions are UI strings: both locales, resolved by the
 * component that displays them.
 */

import type { SettingField } from './resolve.js';

export const SAMPLING_SETTINGS: SettingField[] = [
  {
    // Decided by the generation suffix of the next turn only: the frozen
    // prefix never changes, so this is a live, per-conversation choice.
    key: 'thinking',
    label: { en: 'Reasoning', fr: 'Réflexion' },
    description: {
      en: 'Lets the model think before answering. Slower and longer, often better on hard tasks; costs nothing in the cache.',
      fr: 'Laisse le modèle réfléchir avant de répondre. Plus lent et plus long, souvent meilleur sur les tâches difficiles ; ne coûte rien au cache.',
    },
    type: 'boolean',
    scopes: ['global', 'conversation'],
    default: true,
  },
  {
    key: 'temperature',
    label: { en: 'Temperature', fr: 'Température' },
    description: {
      en: 'Higher = more varied. 0 makes the generation almost deterministic.',
      fr: 'Plus haut = plus varié. 0 rend la génération quasi déterministe.',
    },
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 0.7,
    min: 0,
    max: 2,
    step: 0.05,
  },
  {
    key: 'topP',
    label: { en: 'top_p', fr: 'top_p' },
    description: {
      en: 'Probability mass kept at each token.',
      fr: 'Masse de probabilité conservée à chaque token.',
    },
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 0.95,
    min: 0,
    max: 1,
    step: 0.01,
    advanced: true,
  },
  {
    key: 'topK',
    label: { en: 'top_k', fr: 'top_k' },
    description: {
      en: 'Number of candidates kept. 0 disables it.',
      fr: 'Nombre de candidats conservés. 0 désactive.',
    },
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 40,
    min: 0,
    max: 200,
    step: 1,
    advanced: true,
  },
  {
    key: 'minP',
    label: { en: 'min_p', fr: 'min_p' },
    description: {
      en: 'Threshold relative to the best candidate.',
      fr: 'Seuil relatif au meilleur candidat.',
    },
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 0.05,
    min: 0,
    max: 1,
    step: 0.01,
    advanced: true,
  },
  {
    key: 'seed',
    label: { en: 'Seed', fr: 'Graine' },
    description: {
      en: '-1 for a random seed on every turn.',
      fr: '-1 pour une graine aléatoire à chaque tour.',
    },
    type: 'number',
    scopes: ['global', 'conversation'],
    default: -1,
    step: 1,
    advanced: true,
  },
];

/**
 * The room a conversation may take, chosen below the server's context.
 * Asked by Paul (2026-08-28): choose the maximum space of a conversation,
 * and switch it on or off. Live — it only decides what the next message is
 * allowed to need, so it invalidates nothing.
 */
export const CONTEXT_SETTINGS: SettingField[] = [
  {
    key: 'contextLimitEnabled',
    label: { en: 'Cap the context', fr: 'Plafonner le contexte' },
    description: {
      en: 'Refuse a message once the conversation would exceed the cap below, instead of the server’s whole context.',
      fr: 'Refuser un message dès que la conversation dépasserait le plafond ci-dessous, plutôt que tout le contexte du serveur.',
    },
    type: 'boolean',
    scopes: ['global', 'conversation'],
    default: false,
  },
  {
    key: 'contextLimit',
    label: { en: 'Context cap', fr: 'Plafond de contexte' },
    description: {
      en: 'Tokens this conversation may occupy, reply included. Never above the server’s context size.',
      fr: 'Tokens que cette conversation peut occuper, réponse comprise. Jamais au-dessus de la taille de contexte du serveur.',
    },
    type: 'number',
    scopes: ['global', 'conversation'],
    default: 4096,
    min: 512,
    step: 512,
  },
];

/**
 * Application behaviour, beyond a conversation: what closing the window does,
 * and whether an idle model unloads itself. Asked by Paul (2026-08-28) — a
 * tray to keep bonaparte waiting, and an inactivity timeout, the way LM
 * Studio (idle TTL) and Ollama (keep_alive) unload a model nobody is using.
 */
export const APP_SETTINGS: SettingField[] = [
  {
    key: 'closeToTray',
    label: { en: 'Keep running when the window is closed', fr: 'Rester ouvert quand on ferme la fenêtre' },
    description: {
      en: 'Closing the window sends bonaparte to the notification area instead of quitting. Quit for good from the tray icon.',
      fr: 'Fermer la fenêtre envoie bonaparte dans la zone de notification au lieu de quitter. Quitter pour de bon depuis l’icône du bandeau.',
    },
    type: 'boolean',
    scopes: ['global'],
    default: true,
  },
  {
    key: 'notifyTurnEnd',
    label: { en: 'Notify when a reply is ready', fr: 'Prévenir quand une réponse est prête' },
    description: {
      en: 'A local model can take minutes. When bonaparte is not in front — another window, or waiting in the tray — a notification says the turn is over; a click brings you back to the conversation.',
      fr: 'Un modèle local peut prendre des minutes. Quand bonaparte n’est pas au premier plan — une autre fenêtre, ou en attente dans le bandeau — une notification dit que le tour est fini ; un clic ramène à la conversation.',
    },
    type: 'boolean',
    scopes: ['global'],
    default: true,
  },
  {
    key: 'idleUnload',
    label: { en: 'Unload the model when idle', fr: 'Décharger le modèle en cas d’inactivité' },
    description: {
      en: 'After a while with no message — and when the computer goes to sleep — save the conversation’s state and free the model’s memory. The next message reloads it.',
      fr: 'Après un moment sans message — et quand l’ordinateur se met en veille — sauvegarder l’état de la conversation et libérer la mémoire du modèle. Le message suivant le recharge.',
    },
    type: 'boolean',
    scopes: ['global'],
    default: true,
  },
  {
    key: 'idleUnloadMinutes',
    label: { en: 'Idle before unloading (minutes)', fr: 'Inactivité avant déchargement (minutes)' },
    description: {
      en: 'Minutes of inactivity before the model is unloaded.',
      fr: 'Minutes d’inactivité avant que le modèle soit déchargé.',
    },
    type: 'number',
    scopes: ['global'],
    default: 15,
    min: 1,
    step: 1,
    showFor: { idleUnload: ['true'] },
  },
  {
    key: 'kvBudgetGb',
    label: { en: 'Disk space for saved contexts (GB)', fr: 'Place disque des contextes sauvegardés (Go)' },
    description: {
      en: 'Saved contexts make resuming instant, and they are large — often gigabytes each. Past this budget, the least recently used are dropped: those conversations are computed again when resumed. Nothing of their messages is lost.',
      fr: 'Les contextes sauvegardés rendent la reprise instantanée, et ils sont gros — souvent plusieurs Go chacun. Au-delà de ce budget, les moins récemment utilisés sont retirés : ces conversations sont recalculées à la reprise. Aucun de leurs messages n’est perdu.',
    },
    type: 'number',
    scopes: ['global'],
    default: 16,
    min: 1,
    max: 2000,
    step: 1,
  },
];

export const LAUNCH_SETTINGS: SettingField[] = [
  {
    key: 'nCtx',
    label: { en: 'Context size', fr: 'Taille de contexte' },
    description: {
      en: 'Tokens the server can hold. Enters the KV manifest.',
      fr: 'Tokens que le serveur peut tenir. Entre au manifest KV.',
    },
    type: 'number',
    scopes: ['global'],
    default: 8192,
    min: 512,
    step: 512,
  },
  {
    key: 'nGpuLayers',
    label: { en: 'GPU layers', fr: 'Couches GPU' },
    description: {
      en: 'Empty = decided by llama.cpp from the available memory.',
      fr: 'Vide = décidé par llama.cpp selon la mémoire disponible.',
    },
    type: 'number',
    scopes: ['global'],
    min: 0,
    step: 1,
  },
  {
    key: 'cacheType',
    label: { en: 'KV cache quantization', fr: 'Quantification du cache KV' },
    description: {
      en:
        'K and V share one type: asymmetric types drop llama.cpp onto a slow ' +
        'path, silently.',
      fr:
        'K et V partagent le même type : des types asymétriques font tomber ' +
        'llama.cpp dans un chemin lent, en silence.',
    },
    type: 'select',
    scopes: ['global'],
    default: 'f16',
    options: [
      { value: 'f16', label: { en: 'f16 (default)', fr: 'f16 (défaut)' } },
      { value: 'q8_0', label: { en: 'q8_0 — half the memory', fr: 'q8_0 — moitié moins de mémoire' } },
      { value: 'q4_0', label: { en: 'q4_0 — the most compact', fr: 'q4_0 — le plus compact' } },
    ],
  },
  {
    key: 'flashAttn',
    label: { en: 'Flash attention', fr: 'Flash attention' },
    description: {
      en:
        'Required in practice as soon as the cache is quantized, otherwise ' +
        'every attention re-dequantizes the cache.',
      fr:
        'Requis en pratique dès que le cache est quantifié, sinon chaque ' +
        'attention re-déquantifie le cache.',
    },
    type: 'boolean',
    scopes: ['global'],
    default: true,
  },
  {
    // The app's own launch parameter, not the engine's: Chromium fixes its
    // GPU mode at startup, so a change applies at the next start (D-23).
    key: 'gpuAcceleration',
    label: { en: 'Graphics acceleration', fr: 'Accélération graphique' },
    description: {
      en:
        'Off, the interface uses no video memory: all of it is left to the model. ' +
        'On, pages in the browser view render faster. Auto: on while the Browser plugin is on. ' +
        'Applies when bonaparte restarts.',
      fr:
        'Coupée, l’interface n’utilise aucune mémoire vidéo : toute est laissée au modèle. ' +
        'Active, les pages de la vue navigateur s’affichent plus vite. Auto : active tant que le plugin Navigateur l’est. ' +
        'S’applique au redémarrage de bonaparte.',
    },
    type: 'select',
    scopes: ['global'],
    default: 'off',
    options: [
      { value: 'off', label: { en: 'Off (default)', fr: 'Coupée (défaut)' } },
      { value: 'auto', label: { en: 'Auto — with Browser', fr: 'Auto — avec Navigateur' } },
      { value: 'on', label: { en: 'On', fr: 'Active' } },
    ],
  },
];

/** All of the harness's settings; plugins add theirs on top. */
export const HARNESS_SETTINGS: SettingField[] = [
  ...SAMPLING_SETTINGS,
  ...CONTEXT_SETTINGS,
  ...APP_SETTINGS,
  ...LAUNCH_SETTINGS,
];

/** The keys whose change invalidates saved KV states. */
export const KV_INVALIDATING_KEYS = new Set(['nCtx', 'cacheType']);
