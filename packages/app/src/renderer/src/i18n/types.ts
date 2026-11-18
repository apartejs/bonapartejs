/**
 * Every string the interface shows. One file per language implements this
 * shape, and a spec checks that they hold the same keys. Nothing here is ever
 * sent to a model: that side is English, always.
 */

import type { ModelChoiceView } from '@aparte/bonaparte-shared';
import type { SizeUnits } from '../format.js';

type Verdict = NonNullable<ModelChoiceView['announcement']>['verdict'];
type Problem = NonNullable<ModelChoiceView['problem']>;
type FamilyId = NonNullable<ModelChoiceView['family']>;

/** What loading a model costs, already written in the language's numbers. */
export interface LoadCost {
  seconds: string;
  estimated: boolean;
  vram: string;
  /** The card's memory; null when it could not be measured. */
  gpu: string | null;
}

export interface Messages {
  app: {
    name: string;
  };
  /** Binary units: Mo and Go in French, as Windows writes them. */
  units: SizeUnits;
  /** Proper names; the same in every language, kept here with the rest. */
  families: Record<FamilyId, string>;
  composer: {
    placeholder: string;
  };
  chat: {
    empty: string;
  };
  /** No engine can answer (review of phase 9): the card above the composer. */
  noEngine: { title: string; body: string; held: string; setup: string; readAgain: string };
  engineSetup: {
    /** Back from the panel opened again after the first launch. */
    back: string;
    title: string;
    lede: string;
    modelsLegend: string;
    searching: string;
    perToken(size: string): string;
    verdict: Record<Verdict, string>;
    /** Why the built-in engine cannot run this file, and the way out. */
    problem: Record<Problem, string>;
    announce(cost: LoadCost): string;
    start: string;
    starting: string;
    empty: { title: string; body: string };
    failed: {
      title: string;
      reason: Record<'not-listed' | 'unsupported-family' | 'no-chat-template' | 'too-big' | 'failed', string>;
    };
    /** The llama.cpp a load runs, and keeping it up to date. */
    /** The first launch (task 9.6, board « Premier lancement »). */
    brand: string;
    engines: {
      label: string;
      builtin: string;
      recommended: string;
      builtinHint: string;
      service: string;
      serviceHint: string;
    };
    gpu: { title: string; found: string; memory(size: string): string; unknown: string };
    columns: { file: string; size: string; perToken: string; vram(k: string): string };
    foundIn: string;
    addFolder: string;
    recommended: {
      title: string;
      hint: string;
      download(size: string): string;
      progress(done: string, total: string): string;
      progressLabel(name: string): string;
      failed: { digest: string; failed: string };
    };
    context: {
      label(k: string): string;
      gauge(used: string, total: string): string;
      total(used: string, total: string): string;
      model(size: string): string;
      kv(size: string): string;
      margin(size: string): string;
    };
    service: {
      which: string;
      label: string;
      kinds: Record<'llamacpp' | 'ollama' | 'lmstudio' | 'openai', string>;
      address: string;
      key: string;
      keyPlaceholder: string;
      test: string;
      testing: string;
      connected(models: number): string;
      errors: Record<'invalid-address' | 'unreachable' | 'timeout' | 'refused-key' | 'not-a-service' | 'no-model' | 'failed', string>;
      without: { title: string; items: readonly string[]; later: string };
      connect: string;
      connecting: string;
      note: string;
    };
    llama: {
      found(build: string): string;
      installed(build: string): string;
      configured(build: string | null): string;
      none: string;
      upToDate: string;
      published(build: string): string;
      /** Under a build found on the machine, older than the one published. */
      keptUpToDate: string;
      download(build: string, size: string): string;
      update(size: string): string;
      downloading(build: string, done: string, total: string): string;
      progressLabel: string;
      checkFailed: string;
      failed: { title: string; digest: string; failed: string };
    };
  };
  conversations: {
    new: string;
    list: string;
  };
  /** What the window says while a turn waits: the core's steps, by key. */
  steps: Record<'slot-wait' | 'restore' | 'seed' | 'reread', string>;
  memory: {
    restoreTitle(tokens: string): string;
    restoreLine(seconds: string, instead: string): string;
    restoreSaved(date: string, time: string, size: string): string;
    rereadTitle(tokens: string, duration: string): string;
    rereadReason: Record<
      'evicted' | 'not-saved' | 'behind' | 'other-model' | 'cache-types' | 'context-too-small' | 'engine-died' | 'rewind',
      string
    >;
    /** A memory let go under the disk budget: on which day, under which budget. */
    rereadEvicted(date: string, budget: string): string;
    /** A memory the person released (Settings, Engine and memory). */
    rereadReleased(date: string): string;
    rereadContinue: string;
    /** After a figure no measure backs yet. */
    estimated: string;
    rereadProgress(done: string, total: string): string;
    rereadProgressLabel: string;
  };
  engineCard: {
    /** « Moniteur de ressources » (task 12.4): each figure in words, never by its bar alone. */
    resources: {
      label: string;
      cpu: string;
      memory: string;
      gpu: string;
      unknown: string;
      percent(value: number): string;
      of(used: string, total: string): string;
    };
    ready: string;
    line(context: string, slots: number): string;
    /** A sub-agent works in the engine (task 8.2): the dot's name, and the line. */
    busy: string;
    working(subagent: string): string;
  };
  /** The four modes: the product's names, the same in every language. */
  modes: Record<'lecture' | 'repetition' | 'plume' | 'impro', string>;
  /** The card of a call the core asks about (canvas « Conversation au travail »). */
  approval: {
    /** The card's accessible name. */
    region: string;
    /** What the call does, before its target: « Modifier », « Lancer »… */
    verbs: Record<'edit' | 'write' | 'run' | 'fetch' | 'other', string>;
    /** What closes the question (« ? » with its space in French). */
    question: string;
    /** What the mode of the conversation means for this request. */
    modeNote: Record<'lecture' | 'repetition' | 'plume' | 'impro', string>;
    allow: string;
    allowAndPlume: string;
    refuse: string;
    refuseConfirm: string;
    instructionLabel: string;
    instructionPlaceholder: string;
    hint: string;
    fails: { missing: string; notFound: string; ambiguous(times: number): string };
    /** A sub-agent's call (task 8.2): who asks, and what refusing does. */
    askedBy(name: string): string;
    onlyIt: string;
  };
  /** « À traiter » (board « À traiter », task 8.4). */
  inbox: {
    title: string;
    lede: string;
    none: string;
    kinds: Record<'approval' | 'subagent' | 'question' | 'ci' | 'cost', string>;
    open: string;
    untitled: string;
    /** An approval whose chat is not there to answer it: answered in its conversation. */
    answerThere: string;
    /** An approval while the engine is not loaded: it is given in its conversation, which loads the model first. */
    engineDown: string;
    answer: string;
    pr(number: number): string;
    ciTitle(number: number): string;
    fix: string;
    /** What « Demander à l'agent de corriger » sends, in the person's words. */
    fixMessage(number: number): string;
    showPr: string;
    costTitle(tokens: string, duration: string): string;
    readAgain: string;
    reading: string;
    later: string;
    unreadTitle: string;
    unreadDot: string;
  };
  /** The sub-agents pane (board « Une conversation avec des sous-agents au travail », task 8.2). */
  subagentsPane: {
    /** « 3 sous-agents · 1 fini, 1 en cours, 1 attend ton accord, 1 en file ». */
    summary(count: Record<'total' | 'done' | 'running' | 'waiting' | 'queued' | 'failed' | 'stopped', number>): string;
    /** What Stop says while sub-agents work (the composer's button). */
    stop: string;
    states: Record<'done' | 'running' | 'waiting' | 'queued' | 'failed' | 'stopped', string>;
    /** « 2 outils · 21 s ». */
    meta(calls: number, seconds: number | null): string;
    /** The meta of one still waiting for the slot: nothing done yet. */
    notYet: string;
    /** What it was given, beside the model: « même modèle · lecture seule ». */
    given(tools: 'read' | 'all' | null): string;
    mission: string;
    result: string;
    note: string;
    none: string;
    /** The list of them: its accessible name. */
    list: string;
  };
  /** The line of a tool's call in a reply (canvas « Conversation au travail »): « Lu src/a.ts · 12 lignes ». */
  tools: {
    /** What the call does, in a word: while it runs, once it is done, and its plain name (asked, refused, failed). */
    labels: Record<ToolLineName, { running: string; done: string; name: string }>;
    lines(count: number): string;
    entries(count: number): string;
    matches(count: number, more: boolean): string;
    exitCode(code: number): string;
    timedOut: string;
    stopped: string;
    created: string;
    /** The state word of a call that waits for the person. */
    waiting: string;
  };
  /** The plan card of Lecture (board « Le mode plan au travail »). */
  plan: {
    region: string;
    files: string;
    changes: Record<'new' | 'modified' | 'deleted', string>;
    /** Before the questions left to settle, with its space. */
    toSettle: string;
    launchPlume: string;
    launchRepetition: string;
    adjust: string;
    adjustHint: string;
    launched(mode: string): string;
    modeNote: Record<'plume' | 'repetition', string>;
    /** The person's go-ahead, sent as their message when they launch the plan. */
    goAhead: string;
  };
  /** aparté's own words that bonaparte says its way (« tu », the board's wording): the question, the list. */
  aparteWords: Record<AparteWord, string>;
  /** The shell (board « Conversation au travail »): the sidebar, open and folded into icons. */
  shell: {
    /** A reply finished since the person last looked (task 8.4): the row's blue dot. */
    unread: string;
    /** The entry of « À traiter » in the sidebar, its count named, and its key. */
    inbox: string;
    inboxCount(count: number): string;
    brand: string;
    /** The mascot (task 12.2): its name says its state. */
    mascot: {
      label(state: string): string;
      states: Record<'idle' | 'thinking' | 'talking' | 'reading' | 'waiting' | 'happy' | 'surprised' | 'error' | 'sleeping' | 'wake', string>;
    };
    nav: string;
    navCollapsed: string;
    collapse: string;
    collapseTip: string;
    expand: string;
    expandTip: string;
    newConversation: string;
    /** « Nouvelle discussion » (task 9.7): a conversation without a project. */
    newDiscussion: string;
    search: string;
    searchLabel: string;
    searchTip: string;
    projects: string;
    discussions: string;
    /** A project's row: its name and how many conversations it holds. */
    project(name: string, count: number): string;
    /** Where a conversation's memory is (§12): said by a name, never by a colour alone. */
    memory: { engine: string; saved: string; reread: string };
    /** A conversation in the folded sidebar: its title, and that it waits for the person. */
    railConversation(title: string, waiting: boolean): string;
    engine(model: string): string;
  };
  /** The settings (boards « Réglages · Général », « Apparence »…, task 5.7). */
  settings: {
    nav: string;
    back: string;
    open: string;
    groups: { application: string; engine: string; agent: string };
    pages: { general: string; appearance: string; shortcuts: string; engine: string; models: string; permissions: string; plugins: string; mcp: string };
    /** Réglages · Raccourcis (task 12.1). */
    shortcuts: {
      search: string;
      hint: string;
      groups: { conversations: string; agent: string; panes: string };
      actions: {
        newConversation: string;
        search: string;
        inbox: string;
        sidebar: string;
        previousConversation: string;
        nextConversation: string;
        cycleMode: string;
        rewindLast: string;
        changes: string;
        terminal: string;
        browser: string;
        newTab: string;
      };
      /** The keys aparté owns: shown, not changed here. */
      fixed: { send: string; approve: string; stop: string };
      fixedNote: string;
      capture: string;
      conflict: (other: string) => string;
      /** Keys without Ctrl or Alt, refused (review 12). */
      needsModifier: string;
      none: string;
      /** Each key in the person's words; « or » between two choices. */
      keys: Record<string, string>;
      or: string;
      noMatch: string;
    };
    versions(app: string, llama: string): string;
    llamaMissing: string;
    /** Réglages · Serveurs MCP (task 10.5, board « Réglages · Serveurs MCP »). */
    mcp: {
      intro: string;
      paste: string;
      add: string;
      filter: string;
      show: string;
      tabs: { all(count: number): string; connected(count: number): string; stopped(count: number): string; failed(count: number): string };
      empty: string;
      none: string;
      state: Record<'connected' | 'failed' | 'stopped' | 'off' | 'connecting', string>;
      expand(name: string): string;
      collapse(name: string): string;
      app: string;
      project(name: string): string;
      tools(count: number): string;
      start: string;
      restart: string;
      reconnect: string;
      stop: string;
      remove: string;
      refused(reason: string): string;
      stoppedLine: string;
      offLine: string;
      readOnly(count: number): string;
      writes(count: number): string;
      more(count: number): string;
      hint: string;
      pasteDialog: { title: string; label: string; placeholder: string; submit: string; cancel: string; added(count: number): string; broken(names: string): string; unreadable: string; notJson: string };
      addDialog: { title: string; name: string; nameHint: string; target: string; targetHint: string; scope: string; submit: string; cancel: string; errors: Record<'name' | 'target' | 'unreadable', string> };
    };
    general: {
      language: string;
      languageHint: string;
      startup: string;
      launchAtLogin: string;
      launchAtLoginHint: string;
      closeToTray: string;
      closeToTrayHint: string;
      reopenLast: string;
      conversations: string;
      sidebar: string;
      sidebarHint: string;
      sidebarProject: string;
      sidebarSingle: string;
      autoOpen: string;
      autoOpenHint: string;
      autoOpenNever: string;
      autoOpenApproval: string;
      autoOpenAlways: string;
      worksIn: string;
      worksInHint: string;
      worksInFolder: string;
      worksInBranch: string;
      subagents: string;
      subagentsHint: string;
      subagentsSequential: string;
      subagentsParallel: string;
      notifications: string;
      notificationsHint: string;
      notifyReplyDone: string;
      notifyApproval: string;
      notifyQuestion: string;
      notifyFailure: string;
      banner: string;
      badge: string;
      off: string;
      data: string;
      dataHint: string;
      openFolder: string;
      export: string;
      exported(count: number, folder: string): string;
      exportFailed: string;
      exportLabels: { person: string; assistant: string; untitled: string };
    };
    permissions: {
      intro: string;
      defaultMode: string;
      modeNotes: { lecture: string; repetition: string; plume: string; impro: string };
      alwaysAsk: string;
      alwaysAskHint: string;
      builtins: string[];
      addFileField: string;
      add: string;
      remove(name: string): string;
      network: string;
      networkHint: string;
      networkAsk: string;
      byProject: string;
      open: string;
      openProject(name: string): string;
      noProject: string;
      noProjectHint: string;
    };
    project: {
      /** Its plugins and MCP servers (task 11.3): what it uses, and what it switches off of the app's plugins. */
      extensions: {
        title: string;
        uses(servers: number, plugins: number): string;
        servers: string;
        plugins: string;
        appWide: string;
        none: string;
      };
      badge: string;
      intro: string;
      folders: string;
      root: string;
      removeFolder: string;
      addFolder: string;
      instructions: string;
      instructionsFound(file: string): string;
      noInstructions: string;
      permissions: string;
      projectMode: string;
      alwaysAskHere: string;
    };
    engine: {
      intro: string;
      /** The first launch's panel of the built-in engine, opened again (review of phase 9). */
      setup: string;
      engine: string;
      runningSince(duration: string): string;
      stopped: string;
      model: string;
      llama: string;
      llamaManaged(build: string): string;
      context: string;
      contextLine(tokens: string, slots: number, cacheType: string): string;
      unload: string;
      restart: string;
      busy: string;
      restartQuestion: string;
      restartCost(seconds: string): string;
      /** The settings llama.cpp is launched with, and the one that unloads it (task 7.4). */
      launchContext: string;
      launchContextHint: string;
      launchContextValue(thousands: string): string;
      launchCache: string;
      launchCacheHint: string;
      launchCacheTypes: Record<'f16' | 'q8_0' | 'q4_0', string>;
      /** Part of a model too big for the card on the processor (task 12.3), put back on the card (review 12). */
      launchLayers: string;
      launchLayersHint(layers: number): string;
      launchLayersAll: string;
      launchIdle: string;
      launchIdleHint: string;
      launchIdleMinutes(minutes: number): string;
      launchIdleNever: string;
      /** A setting that restarts the engine (board « Coûts annoncés », 6). */
      launchSettingNames: Record<'nCtx' | 'cacheType' | 'subagents', string>;
      /** Sub-agents in parallel (task 8.3): the slot more and its video memory, or unknown with no model loaded. */
      launchParallel(bytes: string): string;
      launchParallelUnknown: string;
      launchRestartTitle(setting: string): string;
      launchRestartReload(duration: string): string;
      launchNextLoad: string;
      launchMemories(count: number): string;
      launchReply: string;
      launchAfterReply: string;
      launchNowCut: string;
      launchNow: string;
      launchLater: string;
      launchSave: string;
      launchCancel: string;
      launchPending: string;
      restartNow: string;
      cancel: string;
      changeModel: string;
      memories: string;
      memoriesIntro: string;
      budget: string;
      budgetLine(used: string, budget: string): string;
      budgetEdit: string;
      budgetField: string;
      budgetApply: string;
      budgetFrees(titles: string): string;
      budgetFreeAndApply: string;
      columns: { conversation: string; project: string; tokens: string; disk: string; last: string; state: string; action: string };
      inEngine: string;
      saved: string;
      savedOther: string;
      released(duration: string): string;
      release: string;
      noMemory: string;
      seed: string;
      seedLine(tokens: string, restore: string, served: number): string;
      noSeed: string;
    };
    models: {
      intro: string;
      where: string;
      noFolder: string;
      folderCount(count: number): string;
      addFolder: string;
      scanDisk: string;
      scanning(visited: number): string;
      cancel: string;
      scanFound(count: number): string;
      scanNothing: string;
      scanCancelled: string;
      columns: { model: string; size: string; perToken: string; vram: string; last: string; preferred: string };
      running: string;
      never: string;
      yesterday: string;
      preferredOf(name: string): string;
      footnote: string;
      empty: string;
    };
    appearance: {
      theme: string;
      light: string;
      dark: string;
      system: string;
      accent: string;
      accentHint: string;
      accents: { blue: string; teal: string; violet: string; orange: string };
      reading: string;
      textSize: string;
      small: string;
      normal: string;
      large: string;
      density: string;
      comfortable: string;
      compact: string;
      codeFont: string;
    };
  };
  /** The conversation's header, and its « Plus d’actions ». */
  header: {
    more: string;
    rename: string;
    pin: string;
    unpin: string;
    archive: string;
    delete: string;
    titleField: string;
    /** A discussion goes on in a project (task 9.7). */
    attach: string;
    deleteQuestion(title: string): string;
    deleteWhat: string;
    cancel: string;
    confirmDelete: string;
  };
  /** The panes beside the conversation (board « Conversation au travail »): their icons and frames. */
  /** The built-in browser's pane (task 10.1, board « Le navigateur et ses outils »). */
  browser: {
    tabs: string;
    newTab: string;
    newTabTip: string;
    closeTab(label: string): string;
    back: string;
    backTip: string;
    reload: string;
    reloadTip: string;
    address: string;
    placeholder: string;
    device: string;
    desktop: string;
    phone: string;
    select: string;
    comment: string;
    commentTip: string;
    screenshot: string;
    screenshotTip: string;
    reading: string;
    readingLabel: string;
    failed(error: string): string;
    emptyHint: string;
    /** The person's tools on a page (task 10.2): an element shown, comments pinned, the console. */
    tools: {
      group: string;
      selectHint: string;
      commentHint: string;
      comments(count: number): string;
      send: string;
      inPath(path: string): string;
      text: string;
      size: string;
      font: string;
      color: string;
      attach: string;
      commentThis: string;
      commentField(n: number): string;
      commentPlaceholder: string;
      fontOf(size: number, bold: boolean): string;
      removeComment(n: number): string;
      /** What goes into the composer: the element, the comments, the console's errors. */
      elementMessage(element: { selector: string; path: string; text: string; size: string; font: string; color: string }, url: string): string;
      commentsMessage(url: string, comments: readonly { selector: string; text: string }[]): string;
      consoleMessage(url: string, lines: readonly string[]): string;
    };
    console: {
      title: string;
      /** A line's level, said in words: never by its colour alone. */
      error: string;
      warning: string;
      errors(count: number): string;
      warnings(count: number): string;
      empty: string;
      attach: string;
    };
    /** The new tab: what the project runs (task 10.3). */
    runs: {
      intro(project: string): string;
      noProject: string;
      nothing: string;
      runAll: string;
      inProject: string;
      running: string;
      stopped: string;
      exited: string;
      starting: string;
      launchOpen: string;
      open: string;
      stop: string;
      elsewhere: string;
      outside: string;
      footnote: string;
    };
  };
  panels: {
    /** The group of the icons in the header. */
    group: string;
    /** The column of the panes. */
    region: string;
    files: string;
    changes: string;
    /** The icon of Changements while changes wait for the person. */
    changesWaiting(count: number): string;
    terminal: string;
    /** The sub-agents of the conversation (task 8.2). */
    subagents: string;
    /** The built-in browser (task 10.1). */
    browser: string;
    /** A pane over the conversation, in a narrow window. */
    over(name: string): string;
    close: { files: string; changes: string; subagents: string; terminal: string; browser: string };
    closePlugin(name: string): string;
    closeTip: string;
  };
  /** A conversation on its own branch (board « Branches et conversations », task 6.7). */
  branches: {
    where: string;
    inFolder: string;
    inFolderNote: string;
    ownBranch: string;
    ownBranchNote: string;
    branch: string;
    base: string;
    folderNote(name: string): string;
    /** The mark of a row: « sur sa branche, 3 fichiers changés ». */
    mark(files: number): string;
    ahead(count: number, base: string): string;
    openFolder: string;
  };
  /** Going back before a message (board « Revenir en arrière », task 7.2). */
  rewind: {
    /** The message's buttons. */
    action: string;
    branchesAction: string;
    title(excerpt: string): string;
    whatGroup: string;
    both: string;
    bothHint: string;
    conversation: string;
    conversationHint: string;
    code: string;
    codeHint: string;
    reading: string;
    filesBack(names: readonly string[]): string;
    filesStay(names: readonly string[]): string;
    memoryKept: string;
    memoryReread(tokens: string, duration: string): string;
    memoryStill: string;
    kept: string;
    commands(list: string, count: number): string;
    cancel: string;
    confirm: string;
    /** The banner after it. */
    banner(excerpt: string): string;
    bannerCode(excerpt: string): string;
    bannerFiles(count: number): string;
    bannerConversationOnly: string;
    bannerMemoryKept: string;
    bannerMemoryReread(duration: string): string;
    bannerConflicts(names: string): string;
    undo: string;
    failed: string;
  };
  /** The branches of a conversation (« Brancher », task 7.2) — not git's. */
  forks: {
    button: string;
    menu: string;
    shown: string;
    none: string;
    message(label: string): string;
    answer(label: string): string;
    wentBack: string;
    count(messages: number): string;
  };
  /** Compaction (board « Coûts annoncés », 4; task 7.3). */
  compact: {
    /** The « / » command's description. */
    command: string;
    full(percent: number): string;
    counts(used: string, window: string): string;
    bar(percent: number): string;
    line: string;
    now(duration: string): string;
    later: string;
    first(duration: string): string;
    running: string;
    refused: Record<'pending' | 'not-worth' | 'no-room' | 'cut' | 'empty' | 'failed', string>;
  };
  /** A branch's pull request, and archiving a conversation on its branch (task 6.8). */
  /** Changing model (task 7.4; board « Coûts annoncés », 3): the composer's picker and its dialog. */
  modelSwitch: {
    /** Going to a service between two turns (task 9.3): its title, what it loses, what stays. */
    toService: {
      title(model: string, service: string): string;
      lost: string;
      costs: string;
      kept(name: string): string;
      failed: string;
    };
    /** The picker's name. */
    picker: string;
    /** The group the models are listed under. */
    provider: string;
    /** Under a model's name in the list: its size and the video memory it takes. */
    line(size: string, vram: string): string;
    title(name: string): string;
    reload: string;
    /** A duration announced: about that long. */
    about(duration: string): string;
    reread(tokens: string): string;
    vram: string;
    vramAfter(after: string, now: string | null): string;
    kept(name: string): string;
    estimated: string;
    reading: string;
    cancel: string;
    branch: string;
    change: string;
    loading: string;
    refused: Record<'busy' | 'not-listed' | 'unsupported-family' | 'no-chat-template' | 'too-big' | 'failed', string>;
  };
  /** The engine unloaded (task 7.4; board « Coûts annoncés », 5): the card above the composer. */
  /** A service that no longer answers (task 9.3). */
  serviceDown: {
    kind: string;
    title: string;
    line(service: string): string;
    kept(host: string): string;
    retry: string;
    builtin: string;
  };
  engineUnloaded: {
    title(name: string): string;
    titleLoading(name: string): string;
    cost(duration: string, vram: string): string;
    idle(time: string, minutes: number): string;
    unloadedAt(time: string): string;
    held: string;
    load: string;
    other: string;
    loading: string;
    failed: string;
  };
  pr: {
    /** The mark of a row, said whole: « pull request 42 ouverte, CI réussie ». */
    markOpen(number: number, ci: 'success' | 'failure' | 'pending' | null): string;
    markMerged: string;
    /** The header's pill: « PR 42 · CI réussie ». */
    pill(number: number, ci: 'success' | 'failure' | 'pending' | null): string;
    show: string;
    open: string;
    openQuestion: string;
    openWhat(branch: string, base: string): string;
    openConfirm: string;
    openFailed: string;
    cancel: string;
    archiveQuestion(title: string): string;
    uncommitted(files: number): string;
    archiveAnyway: string;
    commitFirst: string;
    archiveNote: string;
  };
  /** The terminal (task 6.6): its tabs, the agent's, a shell that ended. */
  terminal: {
    tabs: string;
    newTab: string;
    agent: string;
    byAgent: string;
    output(name: string): string;
    exited: string;
    restart: string;
    noShell: string;
    exitCode(code: number | null): string;
  };
  /** The « Changements » pane (task 6.4), and the header's counts that open it. */
  changes: {
    files(count: number): string;
    proposed: string;
    applied: string;
    revert: string;
    revertNamed(path: string): string;
    /** « Revenir » found the file changed since: nothing put back. */
    conflict(path: string): string;
    binary: string;
    none: string;
    headerCounts(added: number, removed: number): string;
    /** « +4 », « −4 ». */
    added(count: number): string;
    removed(count: number): string;
  };
  /** Commenting the diff (board « Commenter le diff », task 6.5). */
  review: {
    hint: string;
    /** The first line of the one message the comments leave in. */
    message(count: number): string;
    /** « **3 commentaires** prêts, sur 2 fichiers ». */
    ready(count: number, files: number): { strong: string; rest: string };
    clear: string;
    send: string;
    edit: string;
    editLabel(where: string): string;
    save: string;
    cancel: string;
  };
  /** The « Fichiers » pane (task 6.3): the tree, the preview, the marks. */
  files: {
    tree: string;
    preview(path: string): string;
    /** « M »: the conversation changed it. */
    modified: string;
    /** « P »: a change waits on it. */
    proposed: string;
    binary: string;
    truncated: string;
    choose: string;
    unreadable: string;
    /** The pane's meta without a project. */
    home: string;
  };
  /** « Rechercher » (board « Rechercher (Ctrl K) »), and its opener. */
  search: {
    open: string;
    shortcut: string;
    title: string;
    field: string;
    escape: string;
    results: string;
    conversations: string;
    files: string;
    actions: string;
    untitled: string;
    inCode(words: string): string;
    /** What a new conversation asks when the person searches the code. */
    inCodeAsk(words: string): string;
    newOn(words: string): string;
    hintMove: string;
    hintOpen: string;
    hintClose: string;
    scope: string;
  };
  /** The dialog « Nouveau projet » (board « Nouveau projet »), and its opener. */
  /** « Travailler dans un projet » (task 9.7). */
  attachProject: {
    title: string;
    lede: string;
    none: string;
    newProject: string;
    cancel: string;
    confirm: string;
    failed: string;
  };
  /** Réglages · Plugins and « Ajouter un plugin » (task 11.3). */
  plugins: {
    intro: string;
    add: string;
    create: string;
    /** What « Créer avec l’agent » puts in a new conversation's composer. */
    createPrompt: string;
    filter: string;
    show: string;
    tabs: { all(count: number): string; on(count: number): string; off(count: number): string };
    created: string;
    added: string;
    builtin: string;
    builtinHint: string;
    none: string;
    empty: string;
    appScope: string;
    /** A plugin on trial: seen by its conversation only. */
    trialScope: string;
    onTrial: string;
    trialLine: string;
    openConversation: string;
    /** Its accessible name: which plugin's. */
    openConversationOf: (name: string) => string;
    stopTrial: string;
    stopTrialOf: (name: string) => string;
    projectScope(name: string): string;
    effects: { read: string; write: string; execute: string; network: string; ui: string };
    from: { folder: string; npm: string; git: string; conversation(title: string): string };
    settings: string;
    remove(name: string): string;
    update(version: string): string;
    updateCheck: string;
    stopped(error: string): string;
    switchFor(name: string): string;
    addDialog: {
      title: string;
      close: string;
      source: string;
      folder: string;
      npm: string;
      git: string;
      folderLabel: string;
      browse: string;
      npmLabel: string;
      npmPlaceholder: string;
      npmHelp: string;
      gitUrl: string;
      gitUrlPlaceholder: string;
      gitRef: string;
      gitRefPlaceholder: string;
      read: string;
      reading: string;
      failed(error: string): string;
      manifestRead: string;
      replaces(version: string): string;
      before: string;
      nothing: string;
      willAdd(parts: readonly string[]): string;
      tool(name: string): string;
      pane(title: string): string;
      command(name: string): string;
      warning: string;
      cancel: string;
      addOff: string;
      addOn: string;
    };
    /** A plugin made in a conversation (task 11.4): its card, its tools' lines, its « / » command on trial. */
    card: {
      made: string;
      adds: string;
      may: string;
      tool(name: string): string;
      command(name: string): string;
      pane(title: string): string;
      nothing: string;
      install: string;
      try: string;
      code: string;
      hideCode: string;
      installed: string;
      trying: string;
      kept: string;
      failed(error: string): string;
      lines: { harness_inspect: string; extension_define: string; extension_run: string; extension_stop: string; extension_undefine: string };
      trialGroup: string;
      /** It did not start, and said no reason. */
      notStarted: string;
    };
    search: {
      title: string;
      intro: string;
      provider: string;
      providers: { embedded: string; brave: string; tavily: string; serper: string; searxng: string };
      key: string;
      keyKept: string;
      keyNone: string;
      saveKey: string;
      forgetKey: string;
      url: string;
      urlPlaceholder: string;
      close: string;
    };
  };
  /** When something breaks (task 12.3, board « Quand quelque chose casse »). */
  failures: {
    safe: string;
    lost: string;
    tooBig: {
      context: string;
      title: string;
      headline(needed: string, card: string): string;
      detail(model: string): string;
      offload: string;
      noOffload: string;
      smaller: string;
    };
    llamaMissing: {
      context: string;
      title: string;
      headline: string;
      detail: string;
      download(build: string, size: string): string;
      pick: string;
      service: string;
      picked: string;
      pickFailed(reason: string): string;
    };
    engineDied: {
      context: string;
      title: string;
      headline(code: string | null): string;
      safe: string;
      lost(seconds: string): string;
      lostUnknown: string;
      relaunch: string;
      log: string;
      error: string;
    };
    log: {
      title: string;
      empty: string;
      close: string;
    };
    diskFull: {
      context: string;
      title: string;
      headline(free: string, drive: string): string;
      detail(count: number): string;
      release(count: number): string;
      choose: string;
      /** No older memory to let go: this one will not be saved. */
      nothing: string;
    };
    otherModel: {
      context: string;
      title: string;
      headline(saved: string, running: string): string;
      detail: string;
      back(model: string, seconds: string): string;
      reread(seconds: string): string;
    };
  };
  /** « Réglages de la conversation » (task 12.4). */
  conversationSettings: {
    menu: string;
    title: string;
    hint: string;
    temperature: string;
    temperatureHint(value: string): string;
    thinking: string;
    thinkingDefault(on: boolean): string;
    thinkingOn: string;
    thinkingOff: string;
    contextCap: string;
    contextCapHint: string;
    cancel: string;
    save: string;
    badTemperature: string;
    badCap: string;
  };
  newProject: {
    open: string;
    /** The project new conversations start in. */
    active(name: string): string;
    title: string;
    close: string;
    empty: string;
    choose: string;
    change: string;
    folderHint: string;
    found: string;
    git(branch: string): string;
    gitDetached(commit: string): string;
    scripts(manager: string, scripts: readonly string[]): string;
    instructions(file: string): string;
    services(names: readonly string[]): string;
    nothing: string;
    name: string;
    others: string;
    addFolder: string;
    removeFolder: string;
    remove: string;
    mode: string;
    modeNotes: Record<'lecture' | 'repetition' | 'plume' | 'impro', string>;
    note: string;
    cancel: string;
    create: string;
  };
}

/** The words of aparté's locale that bonaparte says its own way. */
export type AparteWord =
  | 'elicitationSkip'
  | 'elicitationWaiting'
  | 'elicitationOtherPlaceholder'
  | 'elicitationOtherLabel'
  | 'elicitationAnswerLabel'
  | 'questionDeclined'
  | 'conversationWaiting'
  // The question before a conversation is deleted: what goes with it (task 5.9).
  | 'deleteConversationConfirm'
  // A reply that failed, said in the thread (task 12.3): with « tu », as everything bonaparte says.
  | 'errorUnreachable'
  | 'errorTimeout'
  | 'errorRateLimited'
  | 'errorTooLong'
  | 'errorFailed';

/** The tools of the core whose calls have a line of their own. */
export type ToolLineName = 'read_file' | 'list_files' | 'search' | 'edit_file' | 'write_file' | 'run_command' | 'web_fetch';
