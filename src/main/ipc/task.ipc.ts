import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import type { ProgressPayload, TaskPayload, TaskStatus } from '@shared/types';
import { getConfig } from '../config/configStore';
import { detectCached } from '../hardware/detector';
import { acquire, release, setPreventSleepEnabled } from '../system/powerSave';
import { TaskRunner } from '../transcoder/taskRunner';

/** 广播给所有渲染进程 */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

let runner: TaskRunner | null = null;

function getRunner(): TaskRunner {
  if (runner) return runner;
  runner = new TaskRunner(
    {
      onProgress: (p: ProgressPayload) => broadcast(IPC.EVT_PROGRESS, p),
      onLog: (line: string) => broadcast(IPC.EVT_LOG, line),
      onStatus: (id: string, status: TaskStatus, extra?: { error?: string; output?: string }) =>
        broadcast(IPC.EVT_TASK_STATUS, { id, status, ...(extra ?? {}) }),
      onCommand: (id: string, command: string) => broadcast(IPC.EVT_LOG, `[命令] ${id} ${command}`),
      // 任务运行期间阻止系统休眠
      onBusy: () => acquire(),
      onIdle: () => release()
    },
    getConfig().transcode.parallelJobs || 1
  );
  return runner;
}

/** 任务控制（§12） */
export function registerTaskIpc(): void {
  ipcMain.handle(IPC.TASK_START, async (_e, payloads: TaskPayload[]): Promise<{ taskId: string }> => {
    const r = getRunner();
    const cfg = getConfig();
    r.setParallelJobs(cfg.transcode.parallelJobs || 1);
    if (cfg.hardware.autoDetect) {
      r.setContext({ capability: await detectCached(), preferredHW: cfg.transcode.preferredHW });
    }
    r.resetCancelled();
    const list = (payloads ?? []).filter(Boolean);
    // 异步执行，立即返回
    void r.runAll(list);
    return { taskId: `task-${Date.now()}` };
  });

  ipcMain.handle(IPC.TASK_CANCEL, (_e, id?: string) => {
    getRunner().cancel(id);
    return true;
  });

  ipcMain.handle(IPC.TASK_PAUSE, () => {
    getRunner().pause();
    return true;
  });

  ipcMain.handle(IPC.TASK_RESUME, () => {
    getRunner().resume();
    return true;
  });

  // 防休眠开关（持久化由渲染进程写入 config）
  ipcMain.handle(IPC.POWER_SET, (_e, enabled: boolean) => {
    setPreventSleepEnabled(Boolean(enabled));
    return { enabled: Boolean(enabled) };
  });
}
