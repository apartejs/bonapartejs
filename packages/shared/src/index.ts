/**
 * @aparte/bonaparte-shared — types et schémas partagés entre le harness
 * (@aparte/bonaparte-core), l'app Electron et les plugins.
 *
 * Zéro dépendance workspace : ce paquet est une feuille du graphe.
 */

/** Contrat de plugin : manifeste déclaratif et statuts. */
export * from './plugins.js';
// Un `export *` ne met rien dans la portée locale : le contrat du pont, plus
// bas, a besoin du type lui-même.
import type { PluginStatusDto } from './plugins.js';

/** Locales supportées par bonaparte (UI et messages du harness). */
export type BonaparteLocale = 'fr' | 'en';

export const BONAPARTE_LOCALES: readonly BonaparteLocale[] = ['fr', 'en'];

/**
 * Canaux IPC main↔renderer. Un seul endroit fait autorité : le preload et le
 * main importent ces constantes, jamais de littéraux en double.
 */
export const IPC = {
  appVersion: 'app.version',
  configGet: 'config.get',
  configSet: 'config.set',
  backendStart: 'backend.start',
  backendRegister: 'backend.register',
  conversationHistory: 'conversation.history',
  backendStatus: 'backend.status',
  conversationOpen: 'conversation.open',
  conversationList: 'conversation.list',
  conversationCreate: 'conversation.create',
  conversationRename: 'conversation.rename',
  agentSend: 'agent.send',
  kvSave: 'kv.save',
  setupSuggest: 'setup.suggest',
  dialogPickFile: 'dialog.pickFile',
  modelsScan: 'models.scan',
  endpointProbe: 'endpoint.probe',
  openExternal: 'shell.openExternal',
  projectOpen: 'project.open',
  projectCurrent: 'project.current',
  projectsList: 'projects.list',
  projectCreate: 'projects.create',
  projectRename: 'projects.rename',
  projectSetRoots: 'projects.setRoots',
  projectRemove: 'projects.remove',
  dialogPickDirectory: 'dialog.pickDirectory',
  conversationSetProject: 'conversation.setProject',
  modeGet: 'mode.get',
  modeSet: 'mode.set',
  approvalRespond: 'approval.respond',
  pluginsList: 'plugins.list',
  pluginsInvoke: 'plugins.invoke',
  pluginsReload: 'plugins.reload',
  pluginsAck: 'plugins.ack',
  settingsGet: 'settings.get',
  settingsSet: 'settings.set',
  evApproval: 'ev.approval',
  /** Événements poussés main → renderer. */
  evAgent: 'ev.agent',
  evPlugin: 'ev.plugin',
  evBackendStatus: 'ev.backendStatus',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/**
 * Config du MOTEUR llama.cpp (persistée dans global.json). Le modèle n'en
 * fait pas partie : c'est une propriété de chaque conversation, choisie
 * depuis l'inventaire.
 */
export type BackendConfigDto =
  | { mode: 'remote'; url: string }
  | {
      mode: 'managed';
      binPath: string;
      nGpuLayers?: number;
    };

/**
 * Ce qu'une URL s'est révélée être. Un seul protocole : bonaparte ne pilote
 * que llama.cpp, seul à offrir la persistance de contexte qui justifie le
 * produit. `remote` n'est pas un autre fournisseur — c'est le même serveur,
 * simplement pas lancé par nous.
 */
export interface EndpointProbeDto {
  protocol: 'llamacpp';
  baseUrl: string;
  model?: string;
  totalSlots?: number;
}

/** Modèle découvert par l'inventaire (scan des emplacements connus). */
export interface ModelInfoDto {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  source: 'lmstudio' | 'hf-cache' | 'custom' | 'manual';
}

export interface AppConfigDto {
  backend?: BackendConfigDto;
  /** Modèle par défaut des nouvelles conversations (réglable dans Réglages). */
  defaultModel?: {
    path: string;
    nCtx?: number;
  };
  /**
   * Historique des dossiers récents — de l'app, pas d'une conversation. Le
   * projet lui-même appartient à la conversation ouverte : on doit pouvoir
   * discuter sans dossier, et tenir deux conversations sur deux dossiers.
   */
  recentProjects?: string[];
  /** Dernière conversation ouverte, rouverte au démarrage suivant. */
  currentConversationId?: string;
  mode?: PlayModeDto;
  /** Réglages globaux (échantillonnage + lancement), résolus par couches. */
  settings?: Record<string, unknown>;
  /** Langue de l'utilisateur — pilote l'UI ET la langue de réponse du modèle. */
  locale?: BonaparteLocale;
}

/** Modes de jeu (lexique théâtre) — cf. moteur de permissions. */
export type PlayModeDto = 'lecture' | 'repetition' | 'plume' | 'impro';

export interface ProjectDto {
  root: string;
  name: string;
  recents: string[];
}

/**
 * Un projet : une entité NOMMÉE portant un ensemble ORDONNÉ de racines.
 *
 * Le projet définit ce que le modèle peut VOIR ; la conversation définit
 * comment un tour s'exécute. La première racine est le défaut des chemins
 * relatifs — l'ordre est donc porteur de sens, pas cosmétique.
 */
export interface ProjectSummaryDto {
  id: string;
  name: string;
  roots: string[];
}

/** Une conversation dans la liste du menu — assez pour l'afficher et choisir. */
export interface ConversationSummaryDto {
  id: string;
  title: string;
  updatedAt: string;
  /** Projet de rattachement — absent = « sans projet », cas licite. */
  projectId?: string;
  /** Nom du projet, si la conversation en a un. */
  projectName?: string;
  /** Modèle épinglé, s'il l'est. */
  modelName?: string;
  /** Un état KV existe sur disque : la reprise sera instantanée. */
  hasKvState: boolean;
}

/** Comment le menu latéral s'organise — préférence persistée en global. */
export type SidebarGroupingDto = 'project' | 'flat';
export type SidebarSortDto = 'updated' | 'title';

/** Un réglage résolu, tel que l'UI l'affiche : valeur ET provenance. */
export interface ResolvedSettingDto {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  description?: string;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  advanced?: boolean;
  value: unknown;
  /** Couche qui fournit la valeur : 'default' | 'global' | 'conversation'. */
  from: string;
  /** La portée affichée surcharge-t-elle explicitement ce réglage ? */
  overridden: boolean;
  /** Changer ce réglage invalide les états KV sauvegardés. */
  invalidatesKv: boolean;
}

export type SettingScopeDto = 'global' | 'conversation';

/** Demande d'autorisation poussée au renderer pendant la boucle. */
export interface ApprovalRequestDto {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  command?: string;
}

export interface ApprovalResponseDto {
  id: string;
  granted: boolean;
  /** Mémoriser la règle pour ce projet (« toujours autoriser »). */
  always?: boolean;
}

export type BackendStatusDto =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'crashed'
  | 'restarting';

export interface PromptProgressDto {
  total: number;
  cache: number;
  processed: number;
  timeMs: number;
}

export interface CompletionStatsDto {
  promptMs: number;
  promptUncachedTokens: number;
  predictedTokens: number;
  predictedMs: number;
  progress?: PromptProgressDto;
}

/** Événement de flux agent, sérialisé sur l'IPC. */
export type AgentEventDto =
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; content: string }
  | { type: 'done'; stats: CompletionStatsDto }
  | { type: 'error'; message: string };

export interface ConversationEventDto {
  type: 'user' | 'assistant';
  text: string;
  at: string;
}

export type RestoreDto =
  | { restored: true; nRestored: number }
  | { restored: false; reason: string };

export interface ConversationOpenResultDto {
  conversationId: string;
  events: ConversationEventDto[];
  restore: RestoreDto;
  /** Modèle épinglé à la conversation. */
  modelPath?: string;
  modelName?: string;
  /** Taille de contexte de la conversation — dénominateur de la jauge. */
  nCtx?: number;
}

/** L'ouverture exige un choix de modèle (nouvelle conversation en managé). */
export interface NeedsModelDto {
  needsModel: true;
  conversationId: string;
}

export type ConversationOpenReplyDto = ConversationOpenResultDto | NeedsModelDto;

/** Pré-remplissage du panneau de configuration (détection machine). */
export interface SetupSuggestionDto {
  binPath?: string;
}

export type PickFileKind = 'binary' | 'gguf';

/**
 * Contrat du pont preload → renderer (window.bonaparte). Le preload
 * l'implémente, le renderer le consomme — jamais d'ipcRenderer brut exposé.
 */
export interface BonaparteBridge {
  suggestSetup(): Promise<SetupSuggestionDto>;
  pickFile(kind: PickFileKind): Promise<string | null>;
  scanModels(): Promise<ModelInfoDto[]>;
  /** Vérifie qu'un llama-server répond bien à cette URL (mode distant). */
  probeEndpoint(url: string): Promise<EndpointProbeDto | null>;
  /** N'ouvre que des URLs https d'une liste blanche (main process). */
  openExternal(url: string): Promise<void>;
  getVersion(): Promise<string>;
  getConfig(): Promise<AppConfigDto>;
  setConfig(config: AppConfigDto): Promise<void>;
  getBackendStatus(): Promise<BackendStatusDto>;
  startBackend(config: BackendConfigDto): Promise<BackendStatusDto>;
  /** Enregistre le moteur sans s'y connecter (démarrage à froid). */
  registerBackend(config: BackendConfigDto): Promise<void>;
  /**
   * Historique d'une conversation, SANS réveiller le moteur. C'est le chemin
   * de la consultation et de la bascule : lire n'a jamais besoin du cache KV,
   * qui ne sert qu'à la génération suivante.
   */
  conversationHistory(select?: string): Promise<ConversationOpenReplyDto>;
  /** Toutes les conversations, la plus récemment touchée en tête. */
  listConversations(): Promise<ConversationSummaryDto[]>;
  /**
   * Crée une conversation et rend son id. Le projet est optionnel : discuter
   * sans dossier est un usage normal, pas un état dégradé.
   */
  createConversation(projectRoot?: string): Promise<string>;
  renameConversation(id: string, title: string): Promise<void>;
  /** Plugins découverts, avec leurs vues et leurs erreurs éventuelles. */
  listPlugins(): Promise<PluginStatusDto[]>;
  /**
   * Démonte puis re-active tous les plugins, sans redémarrer l'app — donc sans
   * recharger le modèle. Rend l'inventaire à jour.
   */
  reloadPlugins(): Promise<PluginStatusDto[]>;
  /**
   * S'abonne aux événements POUSSÉS par la moitié Node d'un plugin.
   *
   * La vue doit acquitter ce qu'elle a consommé (`ackPluginData`) : sans
   * acquittement, l'hôte met le producteur en pause au seuil haut et il ne
   * repart jamais. C'est le prix de ne rien perdre.
   */
  onPluginEvent(
    listener: (e: { pluginId: string; event: string; payload: unknown }) => void,
  ): () => void;
  /** Déclare `bytes` octets consommés, pour laisser le producteur repartir. */
  ackPluginData(pluginId: string, bytes: number): void;
  /** Appelle une commande de la moitié Node d'un plugin, depuis sa vue. */
  invokePlugin(pluginId: string, command: string, payload?: unknown): Promise<unknown>;
  /** Réglages d'une portée, valeurs résolues et provenance comprises. */
  getSettings(scope: SettingScopeDto): Promise<ResolvedSettingDto[]>;
  /** Pose une surcharge ; `undefined` la retire et rend l'héritage. */
  setSetting(scope: SettingScopeDto, key: string, value: unknown): Promise<void>;
  openConversation(
    id?: string,
    modelPath?: string,
    nCtx?: number,
  ): Promise<ConversationOpenReplyDto>;
  sendMessage(text: string): Promise<void>;
  saveKv(): Promise<boolean>;
  onAgentEvent(listener: (event: AgentEventDto) => void): () => void;
  onBackendStatus(listener: (status: BackendStatusDto) => void): () => void;

  /** Ouvre un dossier de projet (dialogue natif) ; null si annulé. */
  openProject(): Promise<ProjectDto | null>;
  currentProject(): Promise<ProjectDto | null>;

  /** Tous les projets, pour grouper le menu et proposer un déplacement. */
  listProjects(): Promise<ProjectSummaryDto[]>;
  createProject(name: string, roots?: string[]): Promise<ProjectSummaryDto>;
  renameProject(id: string, name: string): Promise<ProjectSummaryDto>;
  /** Remplace les racines EN CONSERVANT l'ordre donné (il est sémantique). */
  setProjectRoots(id: string, roots: string[]): Promise<ProjectSummaryDto>;
  removeProject(id: string): Promise<void>;
  /** Sélecteur de dossier, sans effet de bord : rend juste le chemin choisi. */
  pickDirectory(): Promise<string | null>;
  /** Rattache une conversation à un projet, ou l'en détache avec `null`. */
  setConversationProject(
    conversationId: string,
    projectId: string | null,
  ): Promise<void>;
  getMode(): Promise<PlayModeDto>;
  setMode(mode: PlayModeDto): Promise<void>;
  respondToApproval(response: ApprovalResponseDto): Promise<void>;
  onApprovalRequest(
    listener: (request: ApprovalRequestDto) => void,
  ): () => void;
}
