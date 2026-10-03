import type { Api } from '../preload/preload';

declare global {
  interface Window {
    api: Api;
  }
  /** 构建时注入的应用版本号（见 electron.vite.config.ts） */
  const __APP_VERSION__: string;
}

export {};
