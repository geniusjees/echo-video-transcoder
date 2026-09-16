import type { Api } from '../preload/preload';

declare global {
  interface Window {
    api: Api;
  }
}

export {};
