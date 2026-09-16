import { create } from 'zustand';
import type { ExpertOptions } from '@shared/types';
import { expertOptionsFromConfig } from './configStore';

interface ParamState {
  mode: 'simple' | 'expert';
  /** 「是否调整分辨率」开关（§13.2） */
  scaleResolution: boolean;
  expertOptions: ExpertOptions;
  command: string;
  showCommand: boolean;

  setMode: (mode: 'simple' | 'expert') => void;
  setScaleResolution: (v: boolean) => void;
  setExpertOptions: (o: Partial<ExpertOptions>) => void;
  initFromConfig: (config: Parameters<typeof expertOptionsFromConfig>[0], scale: boolean) => void;
  setCommand: (c: string) => void;
  toggleCommand: () => void;
}

export const useParamStore = create<ParamState>((set) => ({
  mode: 'simple',
  scaleResolution: false,
  expertOptions: expertOptionsFromConfig(null),
  command: '',
  showCommand: false,

  setMode: (mode) => set({ mode }),
  setScaleResolution: (scaleResolution) => set({ scaleResolution }),
  setExpertOptions: (o) => set((s) => ({ expertOptions: { ...s.expertOptions, ...o } })),
  initFromConfig: (config, scale) =>
    set({ expertOptions: expertOptionsFromConfig(config), scaleResolution: scale }),
  setCommand: (command) => set({ command }),
  toggleCommand: () => set((s) => ({ showCommand: !s.showCommand }))
}));
