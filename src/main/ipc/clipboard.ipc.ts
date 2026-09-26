import { clipboard, ipcMain } from 'electron';
import { IPC } from '@shared/constants';

/**
 * 剪贴板写入（供「复制安装命令」等一键复制使用）
 * 渲染进程运行在 file:// 下，navigator.clipboard 属非安全上下文，
 * 因此统一走主进程的 Electron clipboard。
 */
export function registerClipboardIpc(): void {
  ipcMain.handle(IPC.CLIPBOARD_WRITE, (_e, text?: string): boolean => {
    try {
      clipboard.writeText(String(text ?? ''));
      return true;
    } catch {
      return false;
    }
  });
}
