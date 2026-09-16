import { TARGET } from '@shared/constants';
import type { HWCapability, HWKind, ResolvedParams, SimpleDecision, SourceInfo } from '@shared/types';
import { computeAutoBitrate } from './autoBitrate';
import { capBitrate, capFps, capResolution, round1 } from './capRule';
import { pickEncoder } from '../hardware/detector';

/**
 * 普通（简单）模式决策树 —— §7 综合判断 B
 * 只在主进程执行（§4.2），渲染进程仅展示结果（C7）。
 */

export interface DecideCtx {
  /** 「是否调整分辨率」开关（simpleMode.scaleResolution） */
  scaleResolution: boolean;
  /** 目标编码（C3 默认 hevc） */
  codec?: ResolvedParams['codec'];
  container?: ResolvedParams['container'];
  audioCodec?: ResolvedParams['audioCodec'];
  audioBitrateKbps?: number;
  sampleRate?: ResolvedParams['sampleRate'];
  channels?: number;
  /** 硬件能力（用于决定实际编码器） */
  capability?: HWCapability;
  preferredHW?: 'auto' | HWKind;
  /** 目标档位（默认 TARGET，可由 config.simpleMode.target 覆盖） */
  target?: { resolution: number; fps: number; bitrateMbps: number };
}

function baseParams(ctx: DecideCtx): ResolvedParams {
  return {
    resolution: ctx.target?.resolution ?? TARGET.resolution,
    fps: ctx.target?.fps ?? TARGET.fps,
    bitrateMbps: ctx.target?.bitrateMbps ?? TARGET.bitrateMbps,
    codec: ctx.codec ?? (TARGET.codec as ResolvedParams['codec']),
    container: ctx.container ?? 'mp4',
    audioCodec: ctx.audioCodec ?? 'aac',
    audioBitrateKbps: ctx.audioBitrateKbps ?? 192,
    sampleRate: ctx.sampleRate ?? 48000,
    channels: ctx.channels ?? 2,
    capped: false,
    caps: { resolution: false, bitrate: false, fps: false },
    hwCodec: undefined
  };
}

function withEncoder(params: ResolvedParams, ctx: DecideCtx): ResolvedParams {
  if (!ctx.capability || params.codec === 'copy') return params;
  const { encoder, hw } = pickEncoder(ctx.capability, params.codec, ctx.preferredHW ?? 'auto');
  return { ...params, hwCodec: encoder };
}

export function decideSimple(source: SourceInfo, ctx: DecideCtx): SimpleDecision {
  const br = source.bitrateMbps ?? Infinity; // 未知码率 → 保守转码
  const t = ctx.target ?? TARGET;

  // 2) 综合判断：分辨率 / 码率 / 帧率 / 编码 任一超标
  const needByRes = source.height > t.resolution;
  const needByRate = br > t.bitrateMbps;
  const needByFps = source.fps > t.fps;
  const needTranscode = needByRes || needByRate || needByFps;

  // 3) 无需转码
  if (!needTranscode) {
    return {
      action: 'no-op',
      reason: '源已符合统一配置（分辨率/码率/帧率均不超标），无需转码',
      params: null
    };
  }

  const fpsCap = capFps(t.fps, source.fps);
  const resCap = capResolution(t.resolution, source.height);
  const brCap = capBitrate(t.bitrateMbps, source.bitrateMbps);

  // 4) 情形 A：分辨率更低但码率更高 → 保留分辨率、压码率（B 综合判断）
  if (source.height < t.resolution && needByRate) {
    const params = withEncoder(
      {
        ...baseParams(ctx),
        resolution: source.height,
        fps: fpsCap.value,
        bitrateMbps: brCap.value,
        capped: brCap.capped || fpsCap.capped,
        caps: { resolution: false, bitrate: brCap.capped, fps: fpsCap.capped }
      },
      ctx
    );
    return {
      action: 'transcode',
      reason: `分辨率 ${source.height}p 低于目标但码率偏高，保留分辨率并压制码率至 ${params.bitrateMbps}Mbps`,
      params
    };
  }

  // 5) 情形 B：源等于目标 → 按统一配置重编码
  if (source.height === t.resolution) {
    const params = withEncoder(
      {
        ...baseParams(ctx),
        resolution: resCap.value,
        fps: fpsCap.value,
        bitrateMbps: brCap.value,
        capped: brCap.capped || fpsCap.capped || resCap.capped,
        caps: {
          resolution: resCap.capped,
          bitrate: brCap.capped,
          fps: fpsCap.capped
        }
      },
      ctx
    );
    return {
      action: 'transcode',
      reason:
        `按统一配置重编码：${params.resolution}p / ${params.fps}fps / ${params.bitrateMbps}Mbps` +
        (params.caps.bitrate ? `（码率被源码率封顶 ${source.bitrateMbps}Mbps）` : ''),
      params
    };
  }

  // 6) 情形 C：源高于目标
  if (ctx.scaleResolution) {
    // 缩放到目标档位
    const params = withEncoder(
      {
        ...baseParams(ctx),
        resolution: resCap.value,
        fps: fpsCap.value,
        bitrateMbps: brCap.value,
        caps: {
          resolution: false,
          bitrate: brCap.capped,
          fps: fpsCap.capped
        },
        capped: brCap.capped || fpsCap.capped
      },
      ctx
    );
    return {
      action: 'transcode',
      reason: `缩放至 ${params.resolution}p / ${params.fps}fps / ${params.bitrateMbps}Mbps`,
      params
    };
  }

  // 保持分辨率 + 码率自动计算（§7.2）+ 封顶（C6）
  const auto = computeAutoBitrate(
    source.width,
    source.height,
    source.bitrateMbps,
    t.bitrateMbps
  );

  const params = withEncoder(
    {
      ...baseParams(ctx),
      resolution: source.height,
      fps: fpsCap.value,
      bitrateMbps: auto.bitrateMbps,
      capped: auto.cappedBySource || fpsCap.capped,
      caps: { resolution: false, bitrate: auto.cappedBySource, fps: fpsCap.capped }
    },
    ctx
  );

  return {
    action: 'transcode',
    reason:
      `保持 ${source.height}p / ${params.fps}fps，码率自动计算 ` +
      `${auto.rawMbps}Mbps` +
      (auto.cappedBySource
        ? ` → 源码率上限 ${round1(source.bitrateMbps!)}Mbps，已封顶至 ${auto.bitrateMbps}Mbps`
        : ` → ${auto.bitrateMbps}Mbps`),
    params,
    autoBitrate: true
  };
}
