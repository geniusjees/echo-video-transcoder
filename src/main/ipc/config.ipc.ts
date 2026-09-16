import { dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC } from '@shared/constants';
import type { AppConfig, ExpertOptions, Preset } from '@shared/types';
import {
  deletePreset,
  exportPreset,
  getConfig,
  getStorageMode,
  importPreset,
  listPresets,
  saveConfig,
  savePreset
} from '../config/configStore';
import { isWritable } from '../utils/paths';

/** 配置 / 预设 / 文件选择（C1 C2 C8 C10） */
export function registerConfigIpc(): void {
  ipcMain.handle(IPC.CONFIG_GET, () => ({
    config: getConfig(),
    storageMode: getStorageMode()
  }));

  ipcMain.handle(IPC.CONFIG_SAVE, (_e, next: AppConfig) => saveConfig(next));

  ipcMain.handle(
    IPC.PRESET_SAVE,
    (_e, arg: { name: string; options: ExpertOptions; id?: string }) =>
      savePreset(arg.name, arg.options, arg.id)
  );

  ipcMain.handle(IPC.PRESET_DELETE, (_e, id: string) => {
    deletePreset(id);
    return listPresets();
  });

  ipcMain.handle(IPC.PRESET_IMPORT, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '预设', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths.length) return null;
    return importPreset(res.filePaths[0]);
  });

  // 支持两种导出：按预设 id，或直接导出「当前专家设置」
  ipcMain.handle(
    IPC.PRESET_EXPORT,
    async (
      _e,
      arg: string | { id?: string; name?: string; options?: ExpertOptions }
    ): Promise<boolean> => {
      const byId = typeof arg === 'string' ? arg : arg?.id;
      const currentOptions = typeof arg === 'object' ? arg?.options : undefined;
      const fileName = (typeof arg === 'object' && arg?.name ? arg.name : 'preset')
        .replace(/[\\/:*?"<>|]/g, '_')
        .slice(0, 60);

      const res = await dialog.showSaveDialog({
        defaultPath: `${fileName}.json`,
        filters: [{ name: '预设', extensions: ['json'] }]
      });
      if (res.canceled || !res.filePath) return false;

      if (byId) {
        exportPreset(byId, res.filePath);
        return true;
      }
      if (!currentOptions) return false;

      const payload: Preset = {
        id: `u-export-${Date.now().toString(36)}`,
        name: fileName,
        options: currentOptions,
        createdAt: new Date().toISOString()
      };
      fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf-8');
      return true;
    }
  );

  // C10：输出文件夹选择 + 写权限校验
  ipcMain.handle(IPC.SELECT_OUTPUT_DIR, async (_e, current?: string) => {
    const res = await dialog.showOpenDialog({
      defaultPath: current || undefined,
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    const dir = res.filePaths[0];
    if (!isWritable(dir)) {
      return { dir: null, error: '该文件夹不可写入，请重新选择' };
    }
    return { dir, error: null };
  });

  ipcMain.handle(IPC.SELECT_FILES, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '视频',
          extensions: ['mp4', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'webm', 'm4v', 'ts', 'mpg', 'mpeg']
        }
      ]
    });
    if (res.canceled) return [];
    return res.filePaths;
  });

  ipcMain.handle(IPC.OPEN_PATH, (_e, target: string) => {
    if (!target) return;
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      shell.showItemInFolder(path.resolve(target));
    } else if (fs.existsSync(target)) {
      shell.openPath(path.resolve(target));
    }
  });
}
