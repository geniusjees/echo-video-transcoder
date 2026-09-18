import { create } from 'zustand';
import type { AppConfig, ExpertOptions, HWCapability } from '@shared/types';

interface ConfigState {
  config: AppConfig | null;
  storageMode: 'root' | 'userData' | null;
  hardware: HWCapability | null;
  notice: string | null;
  load: () => Promise<void>;
  save: (next: AppConfig) => Promise<void>;
  patch: (patch: Partial<AppConfig>) => Promise<void>;
  setOutputDir: (dir: string) => Promise<void>;
  detect: (force?: boolean) => Promise<HWCapability>;
  setNotice: (n: string | null) => void;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  storageMode: null,
  hardware: null,
  notice: null,

  load: async () => {
    const res = await window.api.configGet();
    set({ config: res.config, storageMode: res.storageMode });
  },

  save: async (next) => {
    const res = await window.api.configSave(next);
    set({ config: next, storageMode: 'root' });
    if (res.warning) set({ notice: res.warning });
  },

  patch: async (patch) => {
    const current = get().config;
    if (!current) return;
    await get().save({ ...current, ...patch });
  },

  setOutputDir: async (dir) => {
    const current = get().config;
    if (!current) return;
    await get().save({ ...current, paths: { ...current.paths, outputDir: dir } });
  },

  detect: async (force) => {
    const hardware = await window.api.hardwareDetect(force);
    set({ hardware });
    return hardware;
  },

  setNotice: (notice) => set({ notice })
}));

/** 由配置生成专家模式默认选项 */
export function expertOptionsFromConfig(config: AppConfig | null): ExpertOptions {
  const d = config?.expertDefaults;
  return {
    videoCodec: d?.videoCodec ?? 'hevc',
    hw: 'auto',
    resolutionMode: d?.resolutionMode ?? 'source',
    allowUpscale: d?.allowUpscale ?? false,
    allowIncreaseFps: d?.allowIncreaseFps ?? false,
    fpsMode: d?.fpsMode ?? 'source',
    bitrateMode: d?.bitrateMode ?? 'crf',
    crf: d?.crf ?? 23,
    audioCodec: d?.audioCodec ?? 'aac',
    audioBitrateKbps: d?.audioBitrateKbps ?? 192,
    sampleRate: d?.sampleRate ?? 48000,
    channels: d?.channels ?? 2,
    container: d?.container ?? 'mp4',
    preset: 'medium',
    extraArgs: d?.extraArgs ?? []
  };
}
