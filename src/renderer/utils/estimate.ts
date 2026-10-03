import { NOOP_RATE_BASE, REF_PIXELS, TARGET, TARGET_CRF } from '@shared/constants';
import type { AudioCodec, QueueItem, ResolvedParams, SourceInfo } from '@shared/types';
import { t } from '../i18n';
import { formatDuration } from './format';

/** 输出体积预估 */

export interface SizeEstimate {
  bytes: number;
  /** true = 按码率推算的预估；false = 源文件实际大小 */
  estimated: boolean;
  /** 展示标签 */
  label: string;
  /** 悬停说明（计算依据） */
  detail: string;
}

/** 容器封装开销（多路复用/索引等） */
const CONTAINER_OVERHEAD: Record<string, number> = {
  mp4: 1.02,
  mov: 1.03,
  mkv: 1.03,
  webm: 1.02
};

/** 输出像素数（由目标高度 + 源宽高比推出，宽取偶数） */
function outputPixels(params: ResolvedParams, source: SourceInfo): number {
  const h = params.resolution > 0 ? params.resolution : source.height || 1080;
  const ratio = source.height > 0 ? source.width / source.height : 16 / 9;
  const w = Math.max(2, Math.round((h * ratio) / 2) * 2);
  return w * h;
}

/**
 * CRF 模式下的等效视频码率（kbps）。
 * 由「输出分辨率 + 编码基准码率 + CRF」推算：基准码率 = 该编码 1080p 等效质量码率，
 * CRF 相对基准每 -6 码率约 ×2。源码率与输出画质无关，不再参与（仅作上限）。
 */
function crfVideoKbps(params: ResolvedParams, source: SourceInfo): number | null {
  const base = NOOP_RATE_BASE[params.codec];
  const crf = typeof params.crf === 'number' && params.crf > 0 ? params.crf : undefined;
  if (params.codec === 'copy' || !Number.isFinite(base) || crf === undefined) return null;
  const refCrf = TARGET_CRF[params.codec] ?? TARGET.crf;
  const ratio = outputPixels(params, source) / REF_PIXELS;
  return base * ratio * Math.pow(2, (refCrf - crf) / 6) * 1000;
}

/**
 * 按生效参数 + 源时长估算输出体积：
 * 视频码率优先取显式码率；CRF 模式按输出分辨率/编码/CRF 推算等效码率，
 * 再叠加音频码率 × 时长。
 */
export function estimateOutputSize(
  params: ResolvedParams,
  source: SourceInfo
): SizeEstimate | null {
  const duration = source.durationSec;
  if (!duration || duration <= 0) return null;

  const container = params.container;
  const overhead = CONTAINER_OVERHEAD[container] ?? 1.02;
  const audioKbps = params.audioCodec === 'none' ? 0 : params.audioBitrateKbps;
  const srcMbps = source.bitrateMbps ?? 0;

  let rawVideoKbps: number;
  let crfText: string | null = null;
  if (params.bitrateMbps > 0) {
    rawVideoKbps = params.bitrateMbps * 1000;
  } else {
    const crfKbps = crfVideoKbps(params, source);
    if (crfKbps !== null) {
      rawVideoKbps = crfKbps;
      crfText = `${t('params.crfPrefix')} ${params.crf}`;
    } else {
      // copy / 无画质参数 → 按源码率
      rawVideoKbps = srcMbps * 1000;
    }
  }

  // C6：输出视频码率不高于源（源码率已知时）
  const videoKbps = srcMbps > 0 ? Math.min(rawVideoKbps, srcMbps * 1000) : rawVideoKbps;
  const videoMbps = videoKbps / 1000;
  const rateText = crfText
    ? `${crfText} ≈ ${videoMbps.toFixed(1)} Mbps`
    : `${Math.round(videoMbps * 10) / 10} Mbps`;

  const bytes = ((videoKbps + audioKbps) / 8) * 1000 * duration * overhead;

  return {
    bytes: Math.max(0, Math.round(bytes)),
    estimated: true,
    label: `${container.toUpperCase()}`,
    detail: [
      `${t('params.bitrate')} ${rateText}`,
      audioKbps ? `${t('params.audio')} ${audioKbps} kbps` : t('params.noAudio'),
      formatDuration(duration),
      `${container.toUpperCase()} +${Math.round((overhead - 1) * 100)}%`
    ].join(' · ')
  };
}

/** 音频提取参数（与 ExtractAudioPage 的表单一致） */
export interface AudioEstimateOptions {
  codec: AudioCodec;
  bitrateKbps: number;
  sampleRate: number;
  channels: number;
  /** 仅提取片段时的起止时间（秒） */
  startSec?: number;
  endSec?: number;
}

/** 无损 / 未压缩格式的实际码率（bps）；有损格式用用户设定的码率 */
function audioBitsPerSecond(opts: AudioEstimateOptions): number {
  // wav = pcm_s16le：采样率 × 声道 × 16bit
  if (opts.codec === 'wav') return opts.sampleRate * opts.channels * 16;
  // flac 无损压缩，经验系数约 0.6
  if (opts.codec === 'flac') return opts.sampleRate * opts.channels * 16 * 0.6;
  return Math.max(0, opts.bitrateKbps) * 1000;
}

/** 音频导出体积预估：码率 × 时长（有片段范围时按片段时长计算） */
export function estimateAudioSize(
  source: SourceInfo,
  opts: AudioEstimateOptions
): SizeEstimate | null {
  if (opts.codec === 'none') return null;

  const total = source.durationSec;
  if (!total || total <= 0) return null;

  const hasRange =
    typeof opts.startSec === 'number' &&
    typeof opts.endSec === 'number' &&
    opts.endSec > opts.startSec;
  const start = hasRange ? Math.min(Math.max(opts.startSec ?? 0, 0), total) : 0;
  const end = hasRange ? Math.min(Math.max(opts.endSec ?? total, start), total) : total;
  const duration = end - start;
  if (duration <= 0) return null;

  const bytes = (audioBitsPerSecond(opts) / 8) * duration;
  const lossless = opts.codec === 'wav' || opts.codec === 'flac';
  const rateText = lossless
    ? `${opts.sampleRate} Hz / ${opts.channels}ch`
    : `${opts.bitrateKbps} kbps`;

  return {
    bytes: Math.max(0, Math.round(bytes)),
    estimated: true,
    label: opts.codec.toUpperCase(),
    detail: [opts.codec.toUpperCase(), rateText, formatDuration(duration)].join(' · ')
  };
}

/**
 * 队列条目对应的体积信息
 * @param params 当前模式下的**生效参数**（普通模式 = 决策结果；专家模式 = 专家参数）
 *               传入 null 表示该条目不需要转码 → 显示源文件大小
 */
export function estimateForItem(
  item: QueueItem,
  params?: ResolvedParams | null
): SizeEstimate | null {
  if (item.status === 'error') return null;

  const effective = params === undefined ? item.resolved : params;

  if (!effective) {
    const size = item.source.fileSizeBytes ?? 0;
    if (!size) return null;
    return {
      bytes: size,
      estimated: false,
      label: 'source',
      detail: t('queue.noTranscode')
    };
  }

  return estimateOutputSize(effective, item.source);
}
