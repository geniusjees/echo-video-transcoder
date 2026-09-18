import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '@shared/constants';
import type {
  AppConfig,
  ConcatPlan,
  ExpertOptions,
  HWCapability,
  ImportProgressPayload,
  Preset,
  ProgressPayload,
  QueueItem,
  Segment,
  SegmentInfo,
  SimpleDecision,
  ResolvedParams,
  SourceInfo,
  TaskPayload,
  TaskStatus
} from '@shared/types';

/**
 * contextBridge 安全桥（§17.2）
 * nodeIntegration=false + sandbox=true，渲染进程只能通过 window.api 访问主进程能力。
 */

function getPathForFile(file: File): string {
  try {
    if (typeof webUtils?.getPathForFile === 'function') return webUtils.getPathForFile(file);
  } catch {
    /* ignore */
  }
  return (file as unknown as { path?: string }).path ?? '';
}

const api = {
  // ---- 环境 ----
  getPathForFile,

  // ---- 配置 ----
  configGet: (): Promise<{ config: AppConfig; storageMode: 'root' | 'userData' }> =>
    ipcRenderer.invoke(IPC.CONFIG_GET),
  configSave: (config: AppConfig) => ipcRenderer.invoke(IPC.CONFIG_SAVE, config),

  // ---- 预设（C8）----
  presetSave: (arg: { name: string; options: ExpertOptions; id?: string }): Promise<Preset> =>
    ipcRenderer.invoke(IPC.PRESET_SAVE, arg),
  presetDelete: (id: string): Promise<Preset[]> => ipcRenderer.invoke(IPC.PRESET_DELETE, id),
  presetImport: (): Promise<Preset | null> => ipcRenderer.invoke(IPC.PRESET_IMPORT),
  /** 导出：传 id 导出已存预设；传 options 直接导出「当前专家设置」 */
  presetExport: (arg: string | { id?: string; name?: string; options?: ExpertOptions }): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PRESET_EXPORT, arg),

  // ---- 硬件 ----
  hardwareDetect: (force?: boolean): Promise<HWCapability> =>
    ipcRenderer.invoke(IPC.HARDWARE_DETECT, force),

  // ---- 媒体 ----
  mediaProbe: (filePath: string): Promise<SourceInfo> =>
    ipcRenderer.invoke(IPC.MEDIA_PROBE, filePath),
  thumbnail: (
    input: string,
    seekSec?: number,
    rotation?: { mode: 0 | 90 | 180 | 270; flip: 'none' | 'horizontal' | 'vertical' }
  ): Promise<string> =>
    ipcRenderer.invoke(IPC.THUMBNAIL, { input, seekSec, rotation }),
  previewPlay: (
    arg: {
      input: string;
      seekSec?: number;
      rotation?: { mode: 0 | 90 | 180 | 270; flip: 'none' | 'horizontal' | 'vertical' };
    }
  ): Promise<boolean> => ipcRenderer.invoke(IPC.PREVIEW_PLAY, arg),
  previewSeek: (
    arg: {
      input: string;
      seekSec?: number;
      rotation?: { mode: 0 | 90 | 180 | 270; flip: 'none' | 'horizontal' | 'vertical' };
    }
  ): Promise<boolean> => ipcRenderer.invoke(IPC.PREVIEW_SEEK, arg),
  previewStop: (): Promise<boolean> => ipcRenderer.invoke(IPC.PREVIEW_STOP),

  // ---- 队列（C9）----
  queueAdd: (arg: {
    filePaths: string[];
    outputDir: string;
    scaleResolution?: boolean;
    mode?: 'simple' | 'expert';
    expert?: ExpertOptions;
  }): Promise<QueueItem[]> => ipcRenderer.invoke(IPC.QUEUE_ADD, arg),

  // ---- 决策树（§7）----
  simpleDecide: (arg: { source: SourceInfo; scaleResolution?: boolean }): Promise<SimpleDecision> =>
    ipcRenderer.invoke(IPC.SIMPLE_DECIDE, arg),
  paramsResolve: (arg: {
    source: SourceInfo;
    options: ExpertOptions;
  }): Promise<ResolvedParams> => ipcRenderer.invoke(IPC.PARAMS_RESOLVE, arg),

  // ---- 拼接（§10.6）----
  concatPlan: (arg: {
    inputs?: string[];
    segments?: Segment[];
    scaleResolution?: boolean;
    expert?: ResolvedParams | null;
  }): Promise<ConcatPlan> => ipcRenderer.invoke(IPC.CONCAT_PLAN, arg),
  concatPreview: (arg: {
    inputs: string[];
    withThumbnail?: boolean;
  }): Promise<SegmentInfo[]> => ipcRenderer.invoke(IPC.CONCAT_PREVIEW, arg),

  // ---- 任务 ----
  taskStart: (payloads: TaskPayload[]): Promise<{ taskId: string }> =>
    ipcRenderer.invoke(IPC.TASK_START, payloads),
  taskCancel: (id?: string): Promise<boolean> => ipcRenderer.invoke(IPC.TASK_CANCEL, id),
  taskPause: (): Promise<boolean> => ipcRenderer.invoke(IPC.TASK_PAUSE),
  taskResume: (): Promise<boolean> => ipcRenderer.invoke(IPC.TASK_RESUME),

  // ---- 命令预览 ----
  buildCommand: (
    arg: { payload: TaskPayload; source?: SourceInfo }
  ): Promise<{ command?: string; commands?: string[] }> =>
    ipcRenderer.invoke(IPC.BUILD_COMMAND, arg),

  // ---- 系统：防休眠 ----
  powerSet: (enabled: boolean): Promise<{ enabled: boolean }> =>
    ipcRenderer.invoke(IPC.POWER_SET, enabled),
  onPowerState: (cb: (p: { active: boolean; enabled: boolean }) => void) => {
    const listener = (_e: unknown, p: { active: boolean; enabled: boolean }) => cb(p);
    ipcRenderer.on(IPC.EVT_POWER_STATE, listener);
    return () => ipcRenderer.removeListener(IPC.EVT_POWER_STATE, listener);
  },

  // ---- 文件选择（C10）----
  selectOutputDir: (current?: string): Promise<{ dir: string | null; error: string | null } | null> =>
    ipcRenderer.invoke(IPC.SELECT_OUTPUT_DIR, current),
  selectFiles: (): Promise<string[]> => ipcRenderer.invoke(IPC.SELECT_FILES),
  /** 选择文件夹（批量导入，含子文件夹） */
  selectFolder: (current?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.SELECT_FOLDER, current),
  /** 展开路径：文件夹 → 递归扫描出的视频文件 */
  expandPaths: (
    paths: string[]
  ): Promise<{ files: string[]; folders: number; truncated: boolean; expandedFromFolders: number }> =>
    ipcRenderer.invoke(IPC.FILES_EXPAND, paths),
  openPath: (target: string): Promise<void> => ipcRenderer.invoke(IPC.OPEN_PATH, target),

  // ---- 事件订阅（M→R）----
  onProgress: (cb: (p: ProgressPayload) => void) => {
    const listener = (_e: unknown, p: ProgressPayload) => cb(p);
    ipcRenderer.on(IPC.EVT_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC.EVT_PROGRESS, listener);
  },
  onLog: (cb: (line: string) => void) => {
    const listener = (_e: unknown, line: string) => cb(line);
    ipcRenderer.on(IPC.EVT_LOG, listener);
    return () => ipcRenderer.removeListener(IPC.EVT_LOG, listener);
  },
  /** 导入（文件夹扫描 / 批量解析）进度 */
  onImportProgress: (cb: (p: ImportProgressPayload) => void) => {
    const listener = (_e: unknown, p: ImportProgressPayload) => cb(p);
    ipcRenderer.on(IPC.EVT_IMPORT_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC.EVT_IMPORT_PROGRESS, listener);
  },
  onTaskStatus: (
    cb: (p: { id: string; status: TaskStatus; error?: string; output?: string }) => void
  ) => {
    const listener = (_e: unknown, p: { id: string; status: TaskStatus }) => cb(p);
    ipcRenderer.on(IPC.EVT_TASK_STATUS, listener);
    return () => ipcRenderer.removeListener(IPC.EVT_TASK_STATUS, listener);
  },
  onAppEnv: (cb: (env: unknown) => void) => {
    const listener = (_e: unknown, env: unknown) => cb(env);
    ipcRenderer.on('app:env', listener);
    return () => ipcRenderer.removeListener('app:env', listener);
  }
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
