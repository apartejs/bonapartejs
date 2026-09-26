// Anti-flash: sets the theme before the first paint (monaparte pattern). A
// file, not an inline script, so the packaged renderer's CSP can refuse
// every inline script.
(function () {
  try {
    var t = localStorage.getItem('bp.theme');
    if (t !== 'dark' && t !== 'light') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-aparte-theme', t);
    document.documentElement.style.colorScheme = t;
  } catch {
    /* default theme */
  }
})();
