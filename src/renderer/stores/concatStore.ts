import { create } from 'zustand';
import type { ConcatPlan, Segment, SegmentInfo, TaskPayload, TaskStatus } from '@shared/types';
import { useConfigStore } from './configStore';
import { useQueueStore } from './queueStore';

/** 拼接子窗体状态：idle = 未显示 */
export type ConcatProgressStatus = 'idle' | 'running' | 'done' | 'error';

interface ConcatState {
  segments: SegmentInfo[];
  plan: ConcatPlan | null;
  outputDir: string;
  outputName: string;
  busy: boolean;
  loading: boolean;

  /** 当前拼接任务 id（与进度事件同一 id） */
  taskId: string | null;
  /** 进度子窗体状态 */
  status: ConcatProgressStatus;
  error?: string;
  /** 输出文件绝对路径（完成后可打开所在目录） */
  output: string;

  addFiles: (paths: string[]) => Promise<void>;
  remove: (id: string) => void;
  move: (from: number, to: number) => void;
  setTrim: (id: string, trim: { startSec: number; endSec: number } | undefined) => void;
  clear: () => void;
  setOutputDir: (dir: string) => void;
  setOutputName: (name: string) => void;
  replan: () => Promise<void>;
  start: () => Promise<void>;
  /** 由任务状态订阅调用：同步子窗体状态并复位 busy */
  applyTaskStatus: (p: { id: string; status: TaskStatus; error?: string }) => void;
  /** 关掉进度子窗体 */
  closeProgress: () => void;
}

function toSegments(infos: SegmentInfo[]): Segment[] {
  return infos.map((s) => ({
    id: s.id,
    input: s.input,
    source: s.source,
    trim: s.trim
  }));
}

export const useConcatStore = create<ConcatState>((set, get) => ({
  segments: [],
  plan: null,
  outputDir: '',
  outputName: 'merged.mp4',
  busy: false,
  loading: false,
  taskId: null,
  status: 'idle',
  output: '',

  addFiles: async (paths) => {
    if (!paths.length) return;
    set({ loading: true });
    try {
      const infos = await window.api.concatPreview({ inputs: paths, withThumbnail: true });
      const { config } = useConfigStore.getState();
      set((s) => ({
        segments: [...s.segments, ...infos],
        outputDir: s.outputDir || config?.paths.concatOutputDir || ''
      }));
      await get().replan();
    } finally {
      set({ loading: false });
    }
  },

  remove: (id) => {
    set((s) => ({ segments: s.segments.filter((x) => x.id !== id) }));
    void get().replan();
  },

  move: (from, to) => {
    set((s) => {
      const next = [...s.segments];
      if (from < 0 || to < 0 || from >= next.length || to >= next.length) return s;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { segments: next };
    });
    void get().replan();
  },

  setTrim: (id, trim) => {
    set((s) => ({
      segments: s.segments.map((x) => (x.id === id ? { ...x, trim } : x))
    }));
    void get().replan();
  },

  clear: () => set({ segments: [], plan: null }),
  setOutputDir: (outputDir) => set({ outputDir }),
  setOutputName: (outputName) => set({ outputName }),

  replan: async () => {
    const { segments } = get();
    if (!segments.length) {
      set({ plan: null });
      return;
    }
    const { config } = useConfigStore.getState();
    const plan = await window.api.concatPlan({
      segments: toSegments(segments),
      scaleResolution: config?.simpleMode.scaleResolution ?? false
    });
    set({ plan });
  },

  start: async () => {
    const { segments, plan, outputDir, outputName } = get();
    if (!plan || !segments.length || !outputDir) return;
    const output = `${outputDir.replace(/[\\/]$/, '')}/${outputName || 'merged.mp4'}`;
    const id = `concat-${Date.now().toString(36)}`;
    const payload: TaskPayload = {
      id,
      kind: 'concat',
      input: segments[0].input,
      output,
      durationSec: plan.totalDurationSec,
      concat: { segments: toSegments(segments), plan }
    };
    // 打开进度子窗体（busy 同时用于禁用「开始拼接」按钮）
    set({ busy: true, taskId: id, status: 'running', error: undefined, output });
    const queue = useQueueStore.getState();
    queue.onLog(`[拼接] 开始：${plan.reason}`);
    await window.api.taskStart([payload]);
  },

  applyTaskStatus: ({ id, status, error }) => {
    // 只处理当前拼接任务，避免与转码队列的任务状态互相干扰
    if (get().taskId !== id) return;

    if (status === 'done') {
      set({ busy: false, status: 'done' });
      return;
    }
    if (status === 'error') {
      set({ busy: false, status: 'error', error: error ?? '' });
      return;
    }
    // cancelled / skipped：直接收起子窗体
    if (status === 'cancelled' || status === 'skipped') {
      set({ busy: false, status: 'idle', taskId: null, error: undefined });
    }
  },

  closeProgress: () => set({ status: 'idle', taskId: null, error: undefined })
}));
