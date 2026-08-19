/**
 * Contrat des traductions de l'UI. Une locale = un fichier (fr.ts, en.ts),
 * tous typés par cette interface. Les chaînes du harness (doctor, erreurs
 * backend) vivent dans @aparte/bonaparte-core, pas ici.
 */

export interface AppTranslations {
  app: {
    tagline: string;
  };
  actions: {
    toggleTheme: string;
    toggleLocale: string;
  };
  setup: {
    eyebrow: string;
    title: string;
    intro: string;
    intentManaged: string;
    intentExisting: string;
    managedNote: string;
    existingNote: string;
    endpointUrl: string;
    endpointProbe: string;
    probing: string;
    probeFailed: string;
    foundLlama: string;
    persistenceYes: string;
    binPath: string;
    binPathPlaceholder: string;
    browse: string;
    detected: string;
    notInstalled: string;
    installWinget: string;
    openReleases: string;
    start: string;
    starting: string;
    failed: string;
  };
  picker: {
    eyebrow: string;
    title: string;
    intro: string;
    scanning: string;
    empty: string;
    searchPlaceholder: string;
    noMatch: string;
    nCtx: string;
    manual: string;
    confirm: string;
  };
  project: {
    eyebrow: string;
    title: string;
    intro: string;
    choose: string;
  };
  approval: {
    eyebrow: string;
    title: string;
    allow: string;
    always: string;
    refuse: string;
  };
  modes: {
    hint: string;
    lecture: string;
    repetition: string;
    plume: string;
    impro: string;
  };
  chat: {
    placeholder: string;
    errorPrefix: string;
    /** Titre du bloc de raisonnement repliable. */
    thinking: string;
  };
  settings: {
    heading: string;
    general: string;
    sampling: string;
    launch: string;
    plugins: string;
    close: string;
    advanced: string;
    inherited: string;
    reset: string;
    kvWarning: string;
    noPlugins: string;
    pluginActive: string;
    pluginFailed: string;
    conversationScope: string;
  };
  tooling: {
    heading: string;
    empty: string;
    collapse: string;
    expand: string;
    loadFailed: string;
  };
  conversations: {
    heading: string;
    create: string;
    empty: string;
    untitled: string;
    /** Aucun dossier rattaché — un usage normal, pas un manque. */
    noProject: string;
    /** Un état KV existe : la reprise sera instantanée. */
    kvReady: string;
    kvReadyHint: string;
  };
  status: {
    stopped: string;
    starting: string;
    ready: string;
    crashed: string;
    restarting: string;
    notConnected: string;
    noProject: string;
    openProjectHint: string;
    restored: string;
    notRestored: string;
    reasons: Record<string, string>;
    prefill: string;
    cacheShare: string;
    save: string;
    saved: string;
    saveFailed: string;
    changeBackend: string;
  };
}
