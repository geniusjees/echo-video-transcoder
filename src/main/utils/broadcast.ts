import { BrowserWindow } from 'electron';

/** 向所有渲染进程广播事件 */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

/**
 * 节流发射器：高频进度事件按时间间隔合并，最后一次强制发送
 */
export function createThrottledEmitter<T>(
  send: (payload: T) => void,
  intervalMs = 120
): (payload: T, force?: boolean) => void {
  let last = 0;
  return (payload: T, force = false) => {
    const now = Date.now();
    if (force || now - last >= intervalMs) {
      last = now;
      send(payload);
    }
  };
}
