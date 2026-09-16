import { create } from 'zustand';

type DropHandler = (paths: string[]) => void;

interface DropState {
  /** 是否正在拖拽文件到窗口（用于显示全屏提示） */
  dragging: boolean;
  /** 当前页面注册的拖拽处理器（仅激活页面会注册） */
  handler: DropHandler | null;
  setDragging: (v: boolean) => void;
  setHandler: (h: DropHandler | null) => void;
}

export const useDropStore = create<DropState>((set) => ({
  dragging: false,
  handler: null,
  setDragging: (dragging) => set({ dragging }),
  setHandler: (handler) => set({ handler })
}));
