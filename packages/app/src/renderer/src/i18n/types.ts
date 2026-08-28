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
  /** Small strings shared across unrelated controls. */
  common: {
    clear: string;
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
    manual: string;
    confirm: string;
    /** `{name}` is the file name of the model that vanished. */
    missingModel: string;
    /** Appended when a message waits for the pick. */
    resendAfterPick: string;
  };
  approval: {
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
    /** `{used}` tokens in the slot, `{limit}` what the conversation may occupy (the server's size, or its own cap). */
    contextOverflow: string;
    /** Same, when the engine declares no context size (remote). */
    contextOverflowUnknown: string;
    /** A reply the server cut at the context ceiling — incomplete, not finished. */
    replyTruncated: string;
    /** Banner at open; `{name}` is the file name of the vanished model. */
    missingModel: string;
    chooseModel: string;
    placeholder: string;
    errorPrefix: string;
    /** Title of the collapsible reasoning block. */
    thinking: string;
  };
  settings: {
    /** Label of the language field in the General section. */
    language: string;
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
  /** The machine's chips in the status strip. */
  resources: {
    heading: string;
    /** `{app}` bonaparte's processes, `{server}` the model server. */
    cpuHint: string;
    ramHint: string;
    gpuHint: string;
  };
  tooling: {
    /** The panel with no tab: what it can open, and the project's scripts. */
    homeHint: string;
    homeScripts: string;
    homeRun: string;
    homeRunOpen: string;
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
    newInProject: string;
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
  thinking: {
    label: string;
    on: string;
    off: string;
    hint: string;
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
    /** The conversation had no state of its own, but its prefix was shared: what it started from. */
    seeded: string;
    reasons: Record<string, string>;
    prefill: string;
    cacheShare: string;
    save: string;
    saved: string;
    saveFailed: string;
    changeBackend: string;
  };
}
