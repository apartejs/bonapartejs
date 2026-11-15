/** The words the main process shows itself: everything else is the window's. */
export interface MainWords {
  /** The notification area: its tooltip and its menu (task 5.9; completed by 8.5). */
  tray: {
    tooltip: string;
    open: string;
    quit: string;
  };
}
