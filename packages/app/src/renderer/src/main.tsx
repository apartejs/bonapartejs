import '@aparte/core/styles.css';
import './app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { bootstrapAparte, bootstrapHighlighting } from './aparte-bootstrap.js';
import { LocaleProvider } from './i18n/LocaleProvider.js';

bootstrapAparte();

// La coloration syntaxique s'installe en tâche de fond : elle est asynchrone
// (shiki charge ses grammaires à la demande) et rien ne justifie de retarder
// le premier rendu pour elle — le premier bloc de code arrive des secondes
// plus tard. Un échec ne doit pas empêcher l'app de démarrer : on rendrait
// alors du code non colorisé, pas un écran blanc.
void bootstrapHighlighting(
  document.documentElement.getAttribute('data-aparte-theme') === 'dark'
    ? 'dark'
    : 'light',
).catch((error: unknown) => {
  console.warn('coloration syntaxique indisponible', error);
});

const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable');

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
