import { create } from 'zustand';

export type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeState {
  /** 用户选择（持久化到 config.theme） */
  mode: ThemeMode;
  /** 实际生效主题 */
  effective: 'dark' | 'light';
  setMode: (mode: ThemeMode) => void;
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

function resolve(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

function applyToDom(effective: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('dark', effective === 'dark');
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'dark',
  effective: 'dark',

  setMode: (mode) => {
    const effective = resolve(mode);
    applyToDom(effective);
    set({ mode, effective });
  }
}));

let mediaListenerBound = false;

/** 跟随系统主题：监听系统配色变化 */
function bindSystemListener(): void {
  if (mediaListenerBound) return;
  mediaListenerBound = true;
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const { mode } = useThemeStore.getState();
      if (mode !== 'system') return;
      const effective = resolve('system');
      applyToDom(effective);
      useThemeStore.setState({ effective });
    };
    mq.addEventListener('change', onChange);
  } catch {
    /* ignore */
  }
}

/** 初始化主题（App 启动时调用一次） */
export function initTheme(mode: ThemeMode): void {
  bindSystemListener();
  useThemeStore.getState().setMode(mode);
}
