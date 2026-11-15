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
  engineSetup: {
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
      reason: Record<'not-listed' | 'unsupported-family' | 'no-chat-template' | 'failed', string>;
    };
    /** The llama.cpp a load runs, and keeping it up to date. */
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
      'evicted' | 'not-saved' | 'behind' | 'other-model' | 'cache-types' | 'context-too-small' | 'engine-died',
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
    ready: string;
    line(context: string): string;
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
    brand: string;
    nav: string;
    navCollapsed: string;
    collapse: string;
    collapseTip: string;
    expand: string;
    expandTip: string;
    newConversation: string;
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
    pages: { general: string; appearance: string; engine: string; models: string; permissions: string };
    versions(app: string, llama: string): string;
    llamaMissing: string;
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
    deleteQuestion(title: string): string;
    deleteWhat: string;
    cancel: string;
    confirmDelete: string;
  };
  /** The panes beside the conversation (board « Conversation au travail »): their icons and frames. */
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
    /** A pane over the conversation, in a narrow window. */
    over(name: string): string;
    close: { files: string; changes: string; terminal: string };
    closeTip: string;
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
  | 'deleteConversationConfirm';

/** The tools of the core whose calls have a line of their own. */
export type ToolLineName = 'read_file' | 'list_files' | 'search' | 'edit_file' | 'write_file' | 'run_command' | 'web_fetch';
