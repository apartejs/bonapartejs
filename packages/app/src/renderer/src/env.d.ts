/// <reference types="vite/client" />

interface Window {
  bonaparte: {
    getVersion(): Promise<string>;
  };
}
