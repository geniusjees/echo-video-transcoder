import { create } from 'zustand';

/**
 * 应用内弹窗（替代 window.alert / window.confirm）。
 *
 * 原因：Electron 里 window.alert / window.confirm 走的是 Chromium 原生对话框，
 * 其标题与按钮文案由系统语言（app.getLocale）渲染，不会跟随软件界面语言设置，
 * 因此界面切到英文时弹窗仍显示中文。应用内弹窗的文案由调用方传入 t(...)，
 * 天然跟随界面语言。
 */

export type DialogKind = 'alert' | 'confirm';

interface DialogState {
  open: boolean;
  kind: DialogKind;
  title: string;
  message: string;
  resolve: ((ok: boolean) => void) | null;
  alert: (message: string, title?: string) => Promise<void>;
  confirm: (message: string, title?: string) => Promise<boolean>;
  close: (ok: boolean) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  open: false,
  kind: 'alert',
  title: '',
  message: '',
  resolve: null,

  alert: (message, title = '') =>
    new Promise<void>((resolve) => {
      set({ open: true, kind: 'alert', title, message, resolve: () => resolve() });
    }),

  confirm: (message, title = '') =>
    new Promise<boolean>((resolve) => {
      set({ open: true, kind: 'confirm', title, message, resolve });
    }),

  close: (ok) => {
    const { resolve } = get();
    set({ open: false, resolve: null });
    resolve?.(ok);
  }
}));

/** 非组件环境（事件回调 / store）可直接调用 */
export const showAlert = (message: string, title?: string): Promise<void> =>
  useDialogStore.getState().alert(message, title);
export const showConfirm = (message: string, title?: string): Promise<boolean> =>
  useDialogStore.getState().confirm(message, title);
