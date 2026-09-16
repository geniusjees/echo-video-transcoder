import type { QueueItem, ResolvedParams, SourceInfo } from '@shared/types';
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
