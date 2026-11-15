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
}
