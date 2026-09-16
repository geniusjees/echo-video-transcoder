import { create } from 'zustand';
import type { ConcatPlan, Segment, SegmentInfo, TaskPayload } from '@shared/types';
import { useConfigStore } from './configStore';
import { useQueueStore } from './queueStore';

interface ConcatState {
  segments: SegmentInfo[];
  plan: ConcatPlan | null;
  outputDir: string;
  outputName: string;
  busy: boolean;
  loading: boolean;

  addFiles: (paths: string[]) => Promise<void>;
  remove: (id: string) => void;
  move: (from: number, to: number) => void;
  setTrim: (id: string, trim: { startSec: number; endSec: number } | undefined) => void;
  clear: () => void;
  setOutputDir: (dir: string) => void;
  setOutputName: (name: string) => void;
  replan: () => Promise<void>;
  start: () => Promise<void>;
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

  addFiles: async (paths) => {
    if (!paths.length) return;
    set({ loading: true });
    try {
      const infos = await window.api.concatPreview({ inputs: paths, withThumbnail: true });
      const { config } = useConfigStore.getState();
      set((s) => ({
        segments: [...s.segments, ...infos],
        outputDir: s.outputDir || config?.paths.outputDir || ''
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
    const payload: TaskPayload = {
      id: `concat-${Date.now().toString(36)}`,
      kind: 'concat',
      input: segments[0].input,
      output,
      durationSec: plan.totalDurationSec,
      concat: { segments: toSegments(segments), plan }
    };
    set({ busy: true });
    const queue = useQueueStore.getState();
    queue.onLog(`[拼接] 开始：${plan.reason}`);
    await window.api.taskStart([payload]);
  }
}));
