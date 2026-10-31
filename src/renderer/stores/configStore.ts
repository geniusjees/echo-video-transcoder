import { create } from 'zustand';
import type {
  AppConfig,
  EditConfig,
  ExpertOptions,
  ExtractAudioConfig,
  HWCapability,
  RotateConfig,
  TranscodeConfig
} from '@shared/types';

interface ConfigState {
  config: AppConfig | null;
  storageMode: 'root' | 'userData' | null;
  hardware: HWCapability | null;
  notice: string | null;
  load: () => Promise<void>;
  save: (next: AppConfig) => Promise<void>;
  patch: (patch: Partial<AppConfig>) => Promise<void>;
  setOutputDir: (dir: string) => Promise<void>;
  /** 拼接页独立输出目录（不与转码共用） */
  setConcatOutputDir: (dir: string) => Promise<void>;
  /** 转码页命名相关设置（后缀 / 与原文件同目录） */
  setTranscodeConfig: (patch: Partial<TranscodeConfig>) => Promise<void>;
  /** 编辑页命名相关设置（与转码页独立保存） */
  setEditConfig: (patch: Partial<EditConfig>) => Promise<void>;
  /** 旋转 / 翻转页命名相关设置（与转码页独立保存） */
  setRotateConfig: (patch: Partial<RotateConfig>) => Promise<void>;
  /** 音频提取页输出设置（提取到原始文件夹） */
  setExtractAudioConfig: (patch: Partial<ExtractAudioConfig>) => Promise<void>;
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

  setConcatOutputDir: async (dir) => {
    const current = get().config;
    if (!current) return;
    await get().save({ ...current, paths: { ...current.paths, concatOutputDir: dir } });
  },

  setTranscodeConfig: async (patch) => {
    const current = get().config;
    if (!current) return;
    await get().save({
      ...current,
      transcode: { ...current.transcode, ...patch }
    });
  },

  setEditConfig: async (patch) => {
    const current = get().config;
    if (!current) return;
    await get().save({
      ...current,
      edit: { ...current.edit, ...patch }
    });
  },

  setRotateConfig: async (patch) => {
    const current = get().config;
    if (!current) return;
    await get().save({
      ...current,
      rotate: { ...current.rotate, ...patch }
    });
  },

  setExtractAudioConfig: async (patch) => {
    const current = get().config;
    if (!current) return;
    await get().save({
      ...current,
      extractAudio: { ...current.extractAudio, ...patch }
    });
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
    crf: d?.crf ?? 26,
    audioCodec: d?.audioCodec ?? 'aac',
    audioBitrateKbps: d?.audioBitrateKbps ?? 192,
    sampleRate: d?.sampleRate ?? 48000,
    channels: d?.channels ?? 2,
    container: d?.container ?? 'mp4',
    preset: 'medium',
    extraArgs: d?.extraArgs ?? []
  };
}
