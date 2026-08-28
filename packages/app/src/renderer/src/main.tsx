import '@aparte/core/styles.css';
import './theme.css';
import './index.css';
import './app.css';
import './composer.css';
import './terminal.css';
import './layout.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { bootstrapAparte, bootstrapHighlighting } from './aparte-bootstrap.js';
import { LocaleProvider } from './i18n/LocaleProvider.js';

bootstrapAparte();

// Syntax highlighting installs itself in the background: it is asynchronous
// (shiki loads its grammars on demand) and nothing justifies delaying the
// first render for it — the first code block arrives seconds later. A
// failure must not prevent the app from starting: we would then render
// non-highlighted code, not a blank screen.
void bootstrapHighlighting().catch((error: unknown) => {
  console.warn('syntax highlighting unavailable', error);
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
