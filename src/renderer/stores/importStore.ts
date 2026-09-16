import { create } from 'zustand';
import type { ImportProgressPayload } from '@shared/types';

interface ImportState {
  active: boolean;
  phase: 'scan' | 'probe';
  /** 已处理数量 */
  done: number;
  /** 总数（0 = 不确定进度） */
  total: number;
  /** scan 阶段已找到的视频数 */
  found: number;
  message: string;

  /** 主动开始（例如点击文件夹导入） */
  begin: (phase: 'scan' | 'probe', message: string, total?: number) => void;
  /** 接收主进程进度事件（自动开始 / 自动结束） */
  apply: (p: ImportProgressPayload) => void;
  finish: () => void;
}

const MIN_VISIBLE_TOTAL = 2;

export const useImportStore = create<ImportState>((set, get) => ({
  active: false,
  phase: 'scan',
  done: 0,
  total: 0,
  found: 0,
  message: '',

  begin: (phase, message, total = 0) =>
    set({ active: true, phase, message, done: 0, total, found: 0 }),

  apply: (p) => {
    if (p.phase === 'scan') {
      // 大目录扫描才显示；小规模不打断界面
      set({
        active: true,
        phase: 'scan',
        message: '正在扫描文件夹…',
        done: p.found ?? 0,
        total: 0,
        found: p.found ?? 0
      });
      return;
    }

    // 没有可解析的文件（例如文件夹里没有视频）→ 直接收起
    if (p.total === 0) {
      set({ active: false });
      return;
    }

    // probe 阶段：条目太少就不显示（避免单文件闪一下）
    const finished = p.done >= p.total;
    if (!get().active && p.total < MIN_VISIBLE_TOTAL) return;

    set({
      active: !finished,
      phase: 'probe',
      message: '正在解析视频…',
      done: p.done,
      total: p.total
    });
  },

  finish: () => set({ active: false, done: 0, total: 0, found: 0 })
}));

/** 计算进度百分比（total = 0 表示不确定进度） */
export function importPercent(s: { done: number; total: number }): number {
  if (!s.total) return 0;
  return Math.min(100, Math.max(0, (s.done / s.total) * 100));
}
