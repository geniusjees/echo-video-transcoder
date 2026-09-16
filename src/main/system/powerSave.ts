import { BrowserWindow, powerSaveBlocker } from 'electron';
import { IPC } from '@shared/constants';

/**
 * 转码过程中阻止系统休眠 / 睡眠
 * 使用 `prevent-app-suspension`：阻止系统进入睡眠，但允许关闭显示器。
 */

let blockerId: number | null = null;
let userEnabled = true;

function broadcast(active: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(IPC.EVT_POWER_STATE, { active, enabled: userEnabled });
    }
  }
}

/** 用户开关（config.advanced.preventSleep） */
export function setPreventSleepEnabled(enabled: boolean): void {
  userEnabled = enabled;
  if (!enabled) release();
  else broadcast(false);
}

export function isPreventSleepEnabled(): boolean {
  return userEnabled;
}

/** 有任务开始运行 */
export function acquire(): void {
  if (!userEnabled || blockerId !== null) return;
  try {
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
    broadcast(true);
  } catch (e) {
    console.error('[power] 阻止休眠失败：', e);
    blockerId = null;
  }
}

/** 所有任务结束 */
export function release(): void {
  if (blockerId === null) return;
  try {
    powerSaveBlocker.stop(blockerId);
  } catch {
    /* ignore */
  }
  blockerId = null;
  broadcast(false);
}

export function isActive(): boolean {
  return blockerId !== null;
}
