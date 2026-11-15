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
