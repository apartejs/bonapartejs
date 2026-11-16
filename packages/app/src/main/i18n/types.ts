/** The words the main process shows itself: everything else is the window's. */
export interface MainWords {
  /** How numbers are written (« 23,1 » or « 23.1 »). */
  locale: 'fr' | 'en';
  /**
   * The notification area: its tooltip and its menu (task 5.9; completed by 8.5, board « Notifications et zone de
   * notification »). On Windows an item's second line follows its label.
   */
  tray: {
    tooltip: string;
    open: string;
    quit: string;
    /** Under « Quitter ». */
    quitWhat: string;
    /** Under the app's name: what waits for the person, or that nothing does. */
    waiting(approvals: number, questions: number): string;
    nothingWaits: string;
    /** Under a conversation that waits. */
    waitsApproval: string;
    waitsAnswer: string;
    untitled: string;
    /** Under the model: the engine's state, and the video memory it takes once ready. */
    engineReady(vram: string | null): string;
    engineStarting: string;
    engineAsleep: string;
    engineStopped: string;
    release: string;
    releaseWhat: string;
    quiet: string;
    /** « Ne pas déranger » on: until when. */
    quietUntil(time: string): string;
    /** A size of video memory (binary units, Windows' way). */
    gib(value: string): string;
  };
  /** A notification: « <what happened> · <the conversation> », then a line (board « Notifications »). */
  notify: {
    done: string;
    approval: string;
    question: string;
    failed: string;
    untitled: string;
    doneBody: string;
    questionBody: string;
    failedBody: string;
    subagent(name: string): string;
    calls: {
      edit(path: string): string;
      write(path: string): string;
      run(command: string): string;
      fetch(url: string): string;
      other(name: string): string;
    };
  };
  /** What the taskbar's badge says, for a screen reader (`setOverlayIcon`). */
  badge: {
    approval: string;
    question: string;
    failed: string;
    /** Replies ready, not read yet. */
    done(count: number): string;
  };
}
