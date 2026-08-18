/// <reference types="vite/client" />

import type { BonaparteBridge } from '@aparte/bonaparte-shared';

declare global {
  interface Window {
    bonaparte: BonaparteBridge;
  }
}

export {};
