import {
  NOOP_RATE_BASE,
  REF_PIXELS,
  TARGET,
  TARGET_CRF,
  isLegacyCodec
} from '@shared/constants';
import type {
  HWCapability,
  HWKind,
  ResolvedParams,
  SimpleDecision,
  SourceInfo,
  VideoCodec
} from '@shared/types';
import { computeAutoBitrate } from './autoBitrate';
import { capBitrate, capFps, capResolution, round1 } from './capRule';
import { pickEncoder } from '../hardware/detector';

/**
 * 普通（简单）模式决策树 —— §7 综合判断 B
 * 只在主进程执行（§4.2），渲染进程仅展示结果（C7）。
 *
 * 不转码阈值 / 编码 CRF 均按「目标编码」查表：
 * - 阈值取 `NOOP_RATE_BASE[目标编码]`（1080p30 基准），再按源像素比缩放；
 * - CRF 取 `TARGET_CRF[目标编码]`；
 * - 现代编码之间不强制互转（避免多次转码损失画质）；
 *   源为旧格式（legacy/探测不到）时兜底转码为现代编码。
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
  /**
   * 目标档位（默认 TARGET，可由 config.simpleMode.target 覆盖）。
   * `bitrateMbps` / `crf` 为可选手动覆盖；留空则按目标编码自动查表。
   */
  target?: { resolution: number; fps: number; bitrateMbps?: number; crf?: number };
}

function baseParams(ctx: DecideCtx, codec: VideoCodec, crf: number): ResolvedParams {
  const target = ctx.target ?? TARGET;
  return {
    resolution: target.resolution,
    fps: target.fps,
    bitrateMbps: 0,
    crf,
    codec,
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
  const targetCodec = (ctx.codec ?? TARGET.codec) as VideoCodec;

  // 不转码阈值 / 自动码率基准：按目标编码查表（1080p 基准），再按源像素比缩放（4K = ×4）
  // 注：仅当 ctx.target 显式提供时才覆盖，TARGET 只作最终兜底。
  const baseRaw = ctx.target?.bitrateMbps ?? NOOP_RATE_BASE[targetCodec] ?? TARGET.bitrateMbps;
  const baseMbps = Number.isFinite(baseRaw) ? baseRaw : TARGET.bitrateMbps;
  const ratio = ((source.width || 1920) * (source.height || 1080)) / REF_PIXELS;
  const threshold = Number.isFinite(baseRaw) ? round1(baseRaw * ratio) : Infinity;
  // 编码 CRF：按目标编码查表（可选手动覆盖）
  const crf = ctx.target?.crf ?? TARGET_CRF[targetCodec] ?? TARGET.crf;

  // 2) 综合判断：分辨率 / 码率 / 帧率 任一超标；旧格式（legacy）兜底转码
  const needByRes = source.height > t.resolution;
  const needByRate = br > threshold;
  const needByFps = source.fps > t.fps;
  const needByLegacy = isLegacyCodec(source.codec); // 仅旧格式兜底，现代编码之间不强制互转
  const needTranscode = needByRes || needByRate || needByFps || needByLegacy;

  // 3) 无需转码
  if (!needTranscode) {
    return {
      action: 'no-op',
      reason: '源已符合统一配置（分辨率/码率/帧率均不超标，且为现代编码），无需转码',
      params: null
    };
  }

  const fpsCap = capFps(t.fps, source.fps);
  const resCap = capResolution(t.resolution, source.height);
  const brCap = capBitrate(baseMbps, source.bitrateMbps);

  // 4) 情形 A：分辨率更低但码率更高 → 保留分辨率、压码率（B 综合判断）
  if (source.height < t.resolution && needByRate) {
    const params = withEncoder(
      {
        ...baseParams(ctx, targetCodec, crf),
        resolution: source.height,
        fps: fpsCap.value,
        capped: brCap.capped || fpsCap.capped,
        caps: { resolution: false, bitrate: brCap.capped, fps: fpsCap.capped }
      },
      ctx
    );
    return {
      action: 'transcode',
      reason: `分辨率 ${source.height}p 低于目标但码率偏高，保留分辨率并按 CRF ${crf} 质量压制`,
      params
    };
  }

  // 5) 情形 B：源等于目标 → 按统一配置重编码
  if (source.height === t.resolution) {
    const params = withEncoder(
      {
        ...baseParams(ctx, targetCodec, crf),
        resolution: resCap.value,
        fps: fpsCap.value,
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
      reason: `按统一配置重编码：${params.resolution}p / ${params.fps}fps / CRF ${crf}`,
      params
    };
  }

  // 6) 情形 C：源高于目标
  if (ctx.scaleResolution) {
    // 缩放到目标档位
    const params = withEncoder(
      {
        ...baseParams(ctx, targetCodec, crf),
        resolution: resCap.value,
        fps: fpsCap.value,
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
      reason: `缩放至 ${params.resolution}p / ${params.fps}fps / CRF ${crf}`,
      params
    };
  }

  // 保持分辨率 + 码率自动计算（§7.2）+ 封顶（C6）
  const auto = computeAutoBitrate(source.width, source.height, source.bitrateMbps, baseMbps);

  const params = withEncoder(
    {
      ...baseParams(ctx, targetCodec, crf),
      resolution: source.height,
      fps: fpsCap.value,
      capped: auto.cappedBySource || fpsCap.capped,
      caps: { resolution: false, bitrate: auto.cappedBySource, fps: fpsCap.capped }
    },
    ctx
  );

  return {
    action: 'transcode',
    reason: `保持 ${source.height}p / ${params.fps}fps，按 CRF ${crf} 质量压制，不提升分辨率`,
    params
  };
}
