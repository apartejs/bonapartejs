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
    refuse: string;
    alwaysCommand: string;
    /** `{binary}`: the program a command runs. */
    alwaysBinary: string;
    alwaysBinaryHint: string;
    /** `{tool}`: the tool's name. */
    alwaysTool: string;
    alwaysToolHint: string;
    /** The label above what an approval shows (a diff, or why the edit will fail). */
    detailsLabel: string;
    /** `{path}`: the file an edit targets. */
    failsMissing: string;
    failsNotFound: string;
    /** `{count}`: occurrences of the text to replace. */
    failsAmbiguous: string;
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
    /** The bubble action that starts a new conversation from this point. */
    branchHere: string;
    /** `{files}`: files that could not be joined. */
    attachSkipped: string;
    /** `{count}` files, `{files}` their names. */
    changedOne: string;
    changedMany: string;
    undoChanges: string;
    undone: string;
    /** `{files}`: changed again since, left as they are. */
    undoConflicts: string;
    /** The compaction turn, in the thread. */
    compacted: string;
    compactedSummary: string;
    /** The banner after a full context. */
    compactOffer: string;
    compactAction: string;
    compacting: string;
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
    pluginOff: string;
    /** The interface's GPU differs from the setting until a restart (P3.1). */
    gpuRestart: string;
    /** `{seconds}`: the model's last load time. */
    gpuRestartCost: string;
    gpuRestartCostUnknown: string;
    gpuRestartFree: string;
    restartNow: string;
    themeLight: string;
    themeDark: string;
    /** MCP servers (P4). */
    mcp: string;
    mcpHint: string;
    mcpEmpty: string;
    mcpName: string;
    mcpNamePlaceholder: string;
    mcpTarget: string;
    mcpTargetPlaceholder: string;
    mcpAdd: string;
    mcpAdding: string;
    /** Why the form was refused. */
    mcpFormErrors: Record<'name' | 'target' | 'exists' | 'unreadable', string>;
    /** The file exists but does not parse. */
    mcpFileUnreadable: string;
    /** `{count}`: the server's tools. */
    mcpConnected: string;
    mcpConnecting: string;
    mcpFailed: string;
    mcpOff: string;
    /** `{name}`: the server. */
    mcpSwitch: string;
    mcpRetry: string;
    mcpRemove: string;
    mcpConfirmRemove: string;
    mcpEditFile: string;
    mcpReload: string;
    /** Entries of the file that could not be read. */
    mcpFileErrors: string;
    mcpFileErrorCodes: Record<string, string>;
    /** `{name}`: the plugin. */
    pluginSwitch: string;
    conversationScope: string;
    pluginReload: string;
    pluginReloading: string;
    pluginReloadHint: string;
    permissions: string;
    permissionsHint: string;
    shortcuts: string;
    shortcutNew: string;
    shortcutSearch: string;
    shortcutComposer: string;
    shortcutSidebar: string;
    shortcutPanel: string;
    shortcutTerminal: string;
    shortcutBrowser: string;
    shortcutSettings: string;
    permissionsEmpty: string;
    /** `{binary}`: the program. */
    grantBinary: string;
    grantCommand: string;
    grantTool: string;
    grantNoProject: string;
    revoke: string;
    /** `{total}` of `{budget}`, `{conversations}` conversations, `{seeds}` prefixes. */
    kvUsage: string;
    kvFree: string;
    /** `{count}`. */
    kvFreed: string;
  };
  /** Model choice, in the composer. */
  models: {
    pick: string;
    scanning: string;
    none: string;
    /** What actually changes when the model changes. */
    switchWarning: string;
    /** `{total}` memory at `{ctx}` tokens; `{weights}` + `{kv}`. */
    memoryHint: string;
    tight: string;
    tooBig: string;
  };
  /** The confirmation before a compaction (D-03: nothing expensive unannounced). */
  compactDialog: {
    title: string;
    reads: string;
    restarts: string;
    keeps: string;
    cancel: string;
    confirm: string;
  };
  /** The confirmation before a conversation changes model (D-03). */
  switchModel: {
    /** `{model}`: the model's name. */
    title: string;
    intro: string;
    /** `{size}`: bytes read. */
    load: string;
    /** `{seconds}`. */
    loadMeasured: string;
    /** `{tokens}`. */
    reprefill: string;
    /** `{seconds}`. */
    reprefillMeasured: string;
    reprefillUnmeasured: string;
    /** `{total}` at `{ctx}` tokens. */
    memory: string;
    /** `{weights}`, `{kv}`. */
    memoryDetail: string;
    /** `{machine}`: the machine's memory. */
    tight: string;
    tooBig: string;
    stateNote: string;
    cancel: string;
    confirm: string;
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
    /** The row's own menu (⋯). */
    rowMenu: string;
    delete: string;
    deleteTitle: string;
    /** `{title}` is the conversation's title. */
    deleteBody: string;
    deleteConfirm: string;
    cancel: string;
    pin: string;
    unpin: string;
    archive: string;
    unarchive: string;
    duplicate: string;
    pinned: string;
    archived: string;
    /** `{count}`: archived conversations. */
    showArchived: string;
    search: string;
    noMatch: string;
    /** Appended to a duplicate's title. */
    copySuffix: string;
    /** Appended to a branch's title. */
    branchSuffix: string;
    /** `{title}`: the parent conversation. */
    branchOf: string;
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
    /** `{files}`: the instruction files the model reads. */
    instructions: string;
    noInstructions: string;
    compact: string;
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
    /** The slot still holds the conversation shown. */
    held: string;
    /** The engine runs; the next message resumes this conversation. */
    deferred: string;
    restored: string;
    /** `{time}`: what the restore took. */
    restoredIn: string;
    /** `{time}`: what computing the restored tokens again would have taken. */
    insteadOf: string;
    /** `{rate}`: generated tokens per second. */
    tokensPerSecond: string;
    /** The prefill: `{done}` of `{total}` prompt tokens read. */
    reading: string;
    /** `{time}`: about how long the prefill still takes. */
    timeLeft: string;
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
