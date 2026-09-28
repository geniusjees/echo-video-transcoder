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

/** CRF 模式拿不到码率，按源码率的经验系数推算 */
function crfFactor(crf?: number): number {
  const c = crf ?? 23;
  if (c <= 18) return 0.95;
  if (c <= 21) return 0.8;
  if (c <= 24) return 0.65;
  if (c <= 27) return 0.5;
  if (c <= 30) return 0.4;
  return 0.3;
}

/** 按生效参数 + 源时长估算输出体积 */
export function estimateOutputSize(
  params: ResolvedParams,
  source: SourceInfo
): SizeEstimate | null {
  const duration = source.durationSec;
  if (!duration || duration <= 0) return null;

  const container = params.container;
  const overhead = CONTAINER_OVERHEAD[container] ?? 1.02;
  const audioKbps = params.audioCodec === 'none' ? 0 : params.audioBitrateKbps;

  let videoKbps: number;
  let rateText: string;
  if (typeof params.crf === 'number' && params.crf > 0) {
    const factor = crfFactor(params.crf);
    videoKbps = (source.bitrateMbps ?? 6) * 1000 * factor;
    rateText = `${t('params.crfPrefix')} ${params.crf} ×${factor}`;
  } else {
    videoKbps = params.bitrateMbps * 1000;
    rateText = `${params.bitrateMbps} Mbps`;
  }

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
