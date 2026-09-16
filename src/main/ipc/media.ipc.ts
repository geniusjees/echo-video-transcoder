import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import type { SourceInfo } from '@shared/types';
import { getConfig } from '../config/configStore';
import { probe, thumbnail } from '../media/probe';

/** ffprobe 探针 / 缩略图 */
export function registerMediaIpc(): void {
  ipcMain.handle(IPC.MEDIA_PROBE, async (_e, filePath: string): Promise<SourceInfo> => {
    const cfg = getConfig();
    return probe(filePath, cfg.paths.ffprobe || undefined);
  });

  ipcMain.handle(
    IPC.THUMBNAIL,
    async (_e, arg: { input: string; seekSec?: number }): Promise<string> => {
      const cfg = getConfig();
      return thumbnail(arg.input, arg.seekSec ?? 1, cfg.paths.ffmpeg || undefined);
    }
  );
}
