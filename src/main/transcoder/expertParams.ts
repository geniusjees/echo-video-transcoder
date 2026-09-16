import type { ExpertOptions, ResolvedParams } from '@shared/types';

/** 专家模式参数解析：实现位于 `@shared/params`，此处转发（主进程 IPC 使用） */
export { resolveExpertParams } from '@shared/params';

export function expertOptionsFromDefaults(defaults: {
  videoCodec: ResolvedParams['codec'];
  resolutionMode: ExpertOptions['resolutionMode'];
  fpsMode: ExpertOptions['fpsMode'];
  bitrateMode: ExpertOptions['bitrateMode'];
  crf: number;
  audioCodec: ResolvedParams['audioCodec'];
  audioBitrateKbps: number;
  sampleRate: ResolvedParams['sampleRate'];
  channels: number;
  container: ResolvedParams['container'];
  extraArgs: string[];
}): ExpertOptions {
  return {
    videoCodec: defaults.videoCodec,
    hw: 'auto',
    resolutionMode: defaults.resolutionMode,
    fpsMode: defaults.fpsMode,
    bitrateMode: defaults.bitrateMode,
    crf: defaults.crf,
    audioCodec: defaults.audioCodec,
    audioBitrateKbps: defaults.audioBitrateKbps,
    sampleRate: defaults.sampleRate,
    channels: defaults.channels,
    container: defaults.container,
    preset: 'medium',
    extraArgs: defaults.extraArgs ?? []
  };
}
