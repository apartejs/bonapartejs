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
    modeRemote: string;
    modeManaged: string;
    url: string;
    urlPlaceholder: string;
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
  chat: {
    placeholder: string;
    errorPrefix: string;
  };
  status: {
    stopped: string;
    starting: string;
    ready: string;
    crashed: string;
    restarting: string;
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
