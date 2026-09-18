import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import type { SourceInfo } from '@shared/types';
import { getConfig } from '../config/configStore';
import { openPreview, previewSeek, previewStop, probe, thumbnail } from '../media/probe';

/** ffprobe 探针 / 缩略图 / 预览 */
export function registerMediaIpc(): void {
  ipcMain.handle(IPC.MEDIA_PROBE, async (_e, filePath: string): Promise<SourceInfo> => {
    const cfg = getConfig();
    return probe(filePath, cfg.paths.ffprobe || undefined);
  });

  ipcMain.handle(
    IPC.THUMBNAIL,
    async (_e, arg: {
      input: string;
      seekSec?: number;
      rotation?: { mode: 0 | 90 | 180 | 270; flip: 'none' | 'horizontal' | 'vertical' };
    }): Promise<string> => {
      const cfg = getConfig();
      return thumbnail(arg.input, arg.seekSec ?? 1, cfg.paths.ffmpeg || undefined, arg.rotation);
    }
  );

  ipcMain.handle(
    IPC.PREVIEW_PLAY,
    async (_e, arg: {
      input: string;
      seekSec?: number;
      rotation?: { mode: 0 | 90 | 180 | 270; flip: 'none' | 'horizontal' | 'vertical' };
    }): Promise<boolean> => {
      try {
        openPreview(arg.input, arg.seekSec ?? 0, arg.rotation);
        return true;
      } catch {
        return false;
      }
    }
  );

  ipcMain.handle(
    IPC.PREVIEW_SEEK,
    async (_e, arg: {
      input: string;
      seekSec?: number;
      rotation?: { mode: 0 | 90 | 180 | 270; flip: 'none' | 'horizontal' | 'vertical' };
    }): Promise<boolean> => {
      try {
        previewSeek(arg.input, arg.seekSec ?? 0, arg.rotation);
        return true;
      } catch {
        return false;
      }
    }
  );

  ipcMain.handle(IPC.PREVIEW_STOP, async (): Promise<boolean> => {
    try {
      previewStop();
      return true;
    } catch {
      return false;
    }
  });
}
