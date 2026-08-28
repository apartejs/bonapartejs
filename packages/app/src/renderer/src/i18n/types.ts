/**
 * Contract for the UI translations. One locale = one file (fr.ts, en.ts),
 * all typed by this interface. The harness's strings (doctor, backend
 * errors) live in @aparte/bonaparte-core, not here.
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
    /** What each mode allows — the name alone doesn't say it. */
    descriptions: {
      lecture: string;
      repetition: string;
      plume: string;
      impro: string;
    };
  };
  chat: {
    placeholder: string;
    errorPrefix: string;
    /** Title of the collapsible reasoning block. */
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
    pluginReload: string;
    pluginReloading: string;
    pluginReloadHint: string;
  };
  /** Model choice, in the composer. */
  models: {
    pick: string;
    scanning: string;
    none: string;
    /** What actually changes when the model changes. */
    switchWarning: string;
  };
  tooling: {
    heading: string;
    empty: string;
    collapse: string;
    expand: string;
    loadFailed: string;
    /** `+` button: open a view in the panel. */
    open: string;
    /** Title of the opening menu. */
    openMenu: string;
    /** Close a tab. */
    close: string;
    /** No active plugin offers a view to open. */
    nothingToOpen: string;
    /** Prompt shown when the panel is open but empty. */
    emptyHint: string;
  };
  /** Binary size units shown next to model files. */
  units: {
    gib: string;
    mib: string;
  };
  conversations: {
    heading: string;
    create: string;
    empty: string;
    untitled: string;
    /** No folder attached — a normal usage, not a gap. */
    noProject: string;
    /** A KV state exists: resuming will be instant. */
    kvReady: string;
    kvReadyHint: string;
    organise: string;
    byProject: string;
    oneList: string;
    sortBy: string;
    sortUpdated: string;
    sortTitle: string;
    projects: string;
    newProject: string;
    editProject: string;
    groupEmpty: string;
  };
  header: {
    noProject: string;
    noProjectHint: string;
    noProjectExplain: string;
    createProject: string;
    editProject: string;
    projectPanel: string;
    noRoots: string;
    /** Root the model resolves its relative paths against. */
    defaultRoot: string;
    rename: string;
    actions: string;
    moveTo: string;
    detach: string;
  };
  /** Project creation/editing dialog (distinct from the `project` screen). */
  projectDialog: {
    createTitle: string;
    editTitle: string;
    name: string;
    namePlaceholder: string;
    roots: string;
    addRoot: string;
    removeRoot: string;
    moveUp: string;
    moveDown: string;
    defaultRoot: string;
    noRootsNote: string;
    delete: string;
    save: string;
    cancel: string;
  };
  temperature: {
    label: string;
    /** The conversation overrides the global default. */
    thisConversation: string;
  };
  /** Shell layout: collapsible and resizable flanks. */
  layout: {
    collapseSidebar: string;
    expandSidebar: string;
    collapsePanel: string;
    expandPanel: string;
    resizeSidebar: string;
    resizePanel: string;
  };
  status: {
    stopped: string;
    starting: string;
    ready: string;
    crashed: string;
    restarting: string;
    notConnected: string;
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
