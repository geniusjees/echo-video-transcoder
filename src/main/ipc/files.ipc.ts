import { dialog, ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import type { ImportProgressPayload } from '@shared/types';
import { expandPaths } from '../media/scan';
import { broadcast, createThrottledEmitter } from '../utils/broadcast';

/** 文件夹选择 / 路径展开（遍历子文件夹） */
export function registerFilesIpc(): void {
  // 选择文件夹（用于批量导入）
  ipcMain.handle(IPC.SELECT_FOLDER, async (_e, current?: string): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: '选择包含视频的文件夹（含子文件夹）',
      defaultPath: current || undefined,
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  // 把 文件/文件夹 混合列表展开为视频文件列表（扫描过程推送进度）
  ipcMain.handle(IPC.FILES_EXPAND, async (_e, paths: string[]) => {
    const emit = createThrottledEmitter<ImportProgressPayload>(
      (p) => broadcast(IPC.EVT_IMPORT_PROGRESS, p),
      100
    );
    const result = expandPaths(paths ?? [], (found, folders) => {
      emit({ phase: 'scan', done: found, total: 0, found, folders });
    });
    return result;
  });
}
