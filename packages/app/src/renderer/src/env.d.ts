/// <reference types="vite/client" />

import type { BonaparteBridge } from '@aparte/bonaparte-shared';

declare global {
  interface Window {
    bonaparte: BonaparteBridge;
  }
}

/**
 * Custom elements d'aparté utilisés dans nos slots (composer custom).
 * La lib les déclare dans le `namespace JSX` global, que React 19 ne consulte
 * plus (le namespace vit désormais sous `React.JSX`) — on augmente donc le
 * module react nous-mêmes. Voir docs/superpowers/aparte-frictions.md.
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'aparte-composer-input': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      'aparte-composer-send': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      'aparte-composer-attachments': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
      'aparte-composer-add-attachment': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

export {};
