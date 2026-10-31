import { create } from 'zustand';
import type {
  ExpertOptions,
  ProgressPayload,
  QueueItem,
  TaskKind,
  TaskPayload,
  TaskStatus
} from '@shared/types';
import type { OutputNamingOptions } from '@shared/outputPath';
import { makeOutputPath } from '../utils/output';
import { useConfigStore } from './configStore';

interface QueueState {
  items: QueueItem[];
  progress: Record<string, ProgressPayload>;
  logs: string[];
  busy: boolean;
  paused: boolean;

  addFiles: (
    paths: string[],
    opts?: {
      scaleResolution?: boolean;
      expert?: ExpertOptions;
      mode?: 'simple' | 'expert';
      /** 输出命名规则（后缀 / 与原文件同目录） */
      naming?: OutputNamingOptions;
    }
  ) => Promise<QueueItem[]>;
  remove: (id: string) => void;
  clear: () => void;
  setItems: (items: QueueItem[]) => void;
  updateItem: (id: string, patch: Partial<QueueItem>) => void;
  setOutputDirForAll: (dir: string, naming?: OutputNamingOptions) => void;

  start: (opts: {
    kind: TaskKind;
    build: (item: QueueItem) => TaskPayload;
    filter?: (item: QueueItem) => boolean;
  }) => Promise<void>;
  cancel: (id?: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;

  onProgress: (p: ProgressPayload) => void;
  onLog: (line: string) => void;
  onStatus: (p: { id: string; status: TaskStatus; error?: string; output?: string }) => void;
  clearLogs: () => void;
}

const MAX_LOGS = 300;
const FINAL_STATUSES = new Set<TaskStatus>(['done', 'error', 'cancelled', 'skipped']);

export function shouldPromptClearQueue(items: QueueItem[]): boolean {
  if (!items.length) return false;
  const hasDone = items.some((item) => item.status === 'done');
  const allFinal = items.every((item) => FINAL_STATUSES.has(item.status));
  return allFinal && hasDone;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  progress: {},
  logs: [],
  busy: false,
  paused: false,

  addFiles: async (paths, opts) => {
    const { config } = useConfigStore.getState();
    const log = get().onLog;
    let items: QueueItem[] = [];
    try {
      items = await window.api.queueAdd({
        filePaths: paths,
        outputDir: config?.paths.outputDir ?? '',
        scaleResolution: opts?.scaleResolution,
        mode: opts?.mode,
        expert: opts?.expert,
        naming: opts?.naming
      });
    } catch (e) {
      log(`[入队] 主进程处理失败：${e instanceof Error ? e.message : String(e)}`);
      return [];
    }

    const failed = items.filter((i) => i.status === 'error');
    const ok = items.length - failed.length;
    log(`[入队] 共 ${items.length} 个：成功 ${ok} 个${failed.length ? `，失败 ${failed.length} 个` : ''}`);
    for (const f of failed) {
      log(`[入队失败] ${f.input}：${f.error ?? '未知原因'}`);
    }

    if (items.length) set((s) => ({ items: [...s.items, ...items] }));
    return items;
  },

  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [], progress: {} }),
  setItems: (items) => set({ items }),

  updateItem: (id, patch) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),

  setOutputDirForAll: (dir, naming) =>
    set((s) => {
      // 幂等：目录与命名规则都未变化时不产生新状态，避免多余重渲染
      const next = s.items.map((i) => ({
        ...i,
        outputDir: dir,
        output: i.resolved
          ? makeOutputPath(i.input, dir, i.resolved.container, 'transcode', naming)
          : i.output
      }));
      const unchanged = next.every(
        (n, idx) => n.output === s.items[idx].output && n.outputDir === s.items[idx].outputDir
      );
      if (unchanged) return s;
      return { items: next };
    }),

  start: async ({ build, filter }) => {
    const items = get().items.filter((i) => (filter ? filter(i) : true));
    const payloads = items.map(build);
    if (!payloads.length) return;
    set({ busy: true, paused: false });
    set((s) => ({
      items: s.items.map((i) =>
        payloads.some((p) => p.id === i.id) ? { ...i, status: 'pending' } : i
      )
    }));
    await window.api.taskStart(payloads);
  },

  cancel: async (id) => {
    await window.api.taskCancel(id);
    set((s) => ({
      items: s.items.map((i) =>
        !id || i.id === id ? (i.status === 'running' ? { ...i, status: 'cancelled' } : i) : i
      ),
      busy: false
    }));
  },

  pause: async () => {
    await window.api.taskPause();
    set({ paused: true });
  },

  resume: async () => {
    await window.api.taskResume();
    set({ paused: false });
  },

  onProgress: (p) =>
    set((s) => ({
      progress: { ...s.progress, [p.id]: p },
      items: s.items.map((i) => (i.id === p.id && i.status !== 'running' ? { ...i, status: 'running' } : i))
    })),

  onLog: (line) =>
    set((s) => ({ logs: [...s.logs.slice(-MAX_LOGS + 1), line] })),

  onStatus: ({ id, status, error, output }) =>
    set((s) => {
      const items = s.items.map((i) =>
        i.id === id ? { ...i, status, error: error ?? i.error, output: output ?? i.output } : i
      );
      const allDone = items.every(
        (i) => i.status === 'done' || i.status === 'error' || i.status === 'cancelled' || i.status === 'skipped'
      );
      return { items, busy: allDone ? false : s.busy };
    }),

  clearLogs: () => set({ logs: [] })
}));

export function defaultOutputFor(item: QueueItem, ext: string, kind: TaskKind): string {
  return makeOutputPath(item.input, item.outputDir, ext, kind);
}
