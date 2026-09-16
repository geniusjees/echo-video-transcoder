import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import { detectCached } from '../hardware/detector';

/** 显卡侦测（C4，含 Apple MPS） */
export function registerHardwareIpc(): void {
  ipcMain.handle(IPC.HARDWARE_DETECT, async (_e, force?: boolean) => detectCached(Boolean(force)));
}
