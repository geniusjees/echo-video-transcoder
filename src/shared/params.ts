import { HW_ENCODERS, REF_PIXELS, SW_FALLBACK, TARGET } from './constants';
import type {
  ExpertOptions,
  HWCapability,
  HWKind,
  ResolvedParams,
  SourceInfo,
  VideoCodec
} from './types';

/**
 * 纯函数参数计算（主进程与渲染进程共用）
 * 放在 shared 里，渲染进程可以直接同步推导专家参数 / 体积预估，无需 IPC 往返。
 */

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------- 封顶规则（C6） ----------------

export interface CapItem<T> {
  value: T;
  capped: boolean;
}

/** 分辨率封顶：目标 > 源 → 取源（不放大） */
export function capResolution(targetHeight: number, sourceHeight: number): CapItem<number> {
  if (sourceHeight > 0 && targetHeight > sourceHeight) {
    return { value: sourceHeight, capped: true };
  }
  return { value: targetHeight, capped: false };
}

/** 帧率封顶：目标 > 源 → 取源（不插帧） */
export function capFps(targetFps: number, sourceFps: number): CapItem<number> {
  if (sourceFps > 0 && targetFps > sourceFps) {
    return { value: sourceFps, capped: true };
  }
  return { value: targetFps, capped: false };
}

/** 码率封顶：目标 > 源 → 取源（不提码率） */
export function capBitrate(targetMbps: number, sourceMbps?: number): CapItem<number> {
  if (typeof sourceMbps === 'number' && sourceMbps > 0 && targetMbps > sourceMbps) {
    return { value: round1(sourceMbps), capped: true };
  }
  return { value: round1(targetMbps), capped: false };
}

/** 对一整套参数统一过封顶（专家模式同样适用，§8） */
export function applyCaps(params: ResolvedParams, source: SourceInfo): ResolvedParams {
  const res = capResolution(params.resolution, source.height);
  const fps = capFps(params.fps, source.fps);
  const br = capBitrate(params.bitrateMbps, source.bitrateMbps);

  return {
    ...params,
    resolution: res.value,
    fps: fps.value,
    bitrateMbps: br.value,
    capped: params.capped || res.capped || fps.capped || br.capped,
    caps: {
      resolution: params.caps?.resolution || res.capped,
      bitrate: params.caps?.bitrate || br.capped,
      fps: params.caps?.fps || fps.capped
    }
  };
}

// ---------------- 码率自动计算（§7.2） ----------------

export interface AutoBitrateResult {
  /** 最终生效码率 Mbps */
  bitrateMbps: number;
  /** 公式计算值（封顶前） */
  rawMbps: number;
  /** 像素比 */
  ratio: number;
  /** 是否被源码率封顶 */
  cappedBySource: boolean;
}

export function computeAutoBitrate(
  width: number,
  height: number,
  sourceBitrateMbps?: number,
  baseMbps: number = TARGET.bitrateMbps
): AutoBitrateResult {
  const srcPixels = Math.max((width || 0) * (height || 0), 1);
  const ratio = srcPixels / REF_PIXELS;
  const base = typeof baseMbps === 'number' && baseMbps > 0 ? baseMbps : TARGET.bitrateMbps;
  const raw = base * ratio;

  let finalMbps = raw;
  let cappedBySource = false;

  if (typeof sourceBitrateMbps === 'number' && sourceBitrateMbps > 0 && raw > sourceBitrateMbps) {
    finalMbps = sourceBitrateMbps;
    cappedBySource = true;
  }

  return {
    bitrateMbps: round1(finalMbps),
    rawMbps: round1(raw),
    ratio: Math.round(ratio * 100) / 100,
    cappedBySource
  };
}

// ---------------- 编码器选择（§9） ----------------

export interface PickedEncoder {
  encoder: string;
  hw: HWKind;
  fellBack: boolean;
}

/** 按硬件能力挑选编码器；硬件不支持目标编码时降级软件（§9.3） */
export function pickEncoderName(
  cap: HWCapability,
  codec: 'hevc' | 'h264' | 'av1' | 'vp9',
  preferred: 'auto' | HWKind = 'auto'
): PickedEncoder {
  const order: HWKind[] =
    preferred === 'auto'
      ? ([cap.recommended, 'nvenc', 'qsv', 'videotoolbox', 'amf', 'vaapi'] as HWKind[])
      : [preferred];

  for (const hw of order) {
    if (hw === 'software') continue;
    if (!cap[hw as keyof HWCapability]) continue;
    const encoder = HW_ENCODERS[hw]?.[codec];
    if (encoder) return { encoder, hw, fellBack: false };
  }
  return { encoder: SW_FALLBACK[codec], hw: 'software', fellBack: true };
}

// ---------------- 专家模式参数解析（§8） ----------------

/** 用户值 → 过封顶（C6）→ 生效值（C7） */
export function resolveExpertParams(
  source: SourceInfo,
  options: ExpertOptions,
  capability?: HWCapability
): ResolvedParams {
  const resTarget =
    options.resolutionMode === 'custom' && options.resolution
      ? options.resolution
      : source.height || 1080;
  const fpsTarget = options.fpsMode === 'custom' && options.fps ? options.fps : source.fps || 30;

  const ratio = source.height ? source.width / source.height : 16 / 9;
  const width = source.width || Math.round((resTarget * ratio) / 2) * 2;

  let bitrateMbps = 0;
  if (options.bitrateMode !== 'crf') {
    if (options.bitrateMode === 'cbr' && options.bitrateMbps) {
      bitrateMbps = options.bitrateMbps;
    } else {
      bitrateMbps = computeAutoBitrate(width, resTarget, source.bitrateMbps, options.bitrateMbps)
        .bitrateMbps;
    }
  }

  const codec: VideoCodec = options.videoCodec;
  let hwCodec: string | undefined;
  if (capability && codec !== 'copy') {
    hwCodec = pickEncoderName(capability, codec, options.hw === 'auto' ? 'auto' : options.hw)
      .encoder;
  }

  const params: ResolvedParams = {
    resolution: resTarget,
    fps: fpsTarget,
    bitrateMbps,
    codec,
    container: options.container,
    audioCodec: options.audioCodec,
    audioBitrateKbps: options.audioBitrateKbps,
    sampleRate: options.sampleRate,
    channels: options.channels,
    hwCodec,
    crf: options.bitrateMode === 'crf' ? options.crf : undefined,
    capped: false,
    caps: { resolution: false, bitrate: false, fps: false }
  };

  return applyCaps(params, source);
}
