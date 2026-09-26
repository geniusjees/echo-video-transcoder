import { create } from 'zustand';

interface UiState {
  /** 日志弹窗开关（触发按钮位于「操作」模块内） */
  logOpen: boolean;
  setLogOpen: (v: boolean) => void;
  /** 启动自检缺失的必需二进制（ffmpeg / ffprobe）；非空则弹出提示框 */
  missingRequiredBins: string[];
  /** 建议的安装命令（供一键复制） */
  installCommand: string;
  /** 用户关闭后不再打扰 */
  missingBinsDismissed: boolean;
  notifyMissingBins: (bins: string[], installCommand: string) => void;
  dismissMissingBins: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  logOpen: false,
  setLogOpen: (logOpen) => set({ logOpen }),
  missingRequiredBins: [],
  installCommand: '',
  missingBinsDismissed: false,
  notifyMissingBins: (missingRequiredBins, installCommand) =>
    set({ missingRequiredBins, installCommand }),
  dismissMissingBins: () => set({ missingBinsDismissed: true })
}));
