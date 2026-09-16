import { create } from 'zustand';

interface UiState {
  /** 日志弹窗开关（触发按钮位于「操作」模块内） */
  logOpen: boolean;
  setLogOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  logOpen: false,
  setLogOpen: (logOpen) => set({ logOpen })
}));
