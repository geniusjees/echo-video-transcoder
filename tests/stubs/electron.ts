import os from 'node:os';
import path from 'node:path';

/** vitest 环境下的 electron 桩（主进程路径解析用） */
export const app = {
  isPackaged: false,
  getPath: (name: string) => (name === 'userData' ? path.join(os.tmpdir(), 'vt-test') : os.tmpdir()),
  getName: () => 'video-transcoder-test',
  whenReady: () => Promise.resolve(),
  quit: () => undefined,
  on: () => undefined
};

export class BrowserWindow {
  static getAllWindows(): BrowserWindow[] {
    return [];
  }
  webContents = { send: () => undefined };
}

export const ipcMain = { handle: () => undefined, on: () => undefined };
export const ipcRenderer = { invoke: () => Promise.resolve(), on: () => undefined };
export const contextBridge = { exposeInMainWorld: () => undefined };
export const shell = { openPath: () => Promise.resolve(''), showItemInFolder: () => undefined };
export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] as string[] }),
  showSaveDialog: () => Promise.resolve({ canceled: true, filePath: '' })
};
