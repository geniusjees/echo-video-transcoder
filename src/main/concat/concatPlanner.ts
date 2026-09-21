import { AUDIO_UNIFY, TARGET } from '@shared/constants';
import { formatConcatReason } from '@shared/concatI18n';
import type {
  ConcatPlan,
  HWCapability,
  HWKind,
  ResolvedParams,
  Segment,
  SimpleDecision,
  SourceInfo
} from '@shared/types';
import { computeAutoBitrate } from '../transcoder/autoBitrate';
import { capFps, capResolution } from '../transcoder/capRule';
import { decideSimple } from '../transcoder/simpleDecision';

/**
 * 拼接方案决策（§10.6）
 * 1. probe 全部片段
 * 2. 参数一致 → 纯拼接(-c copy)；否则 → 统一转码对齐后 concat
 * 3. 音频统一（A 方案）：48kHz / 立体声；无声片段补静音
 */

export interface PlanOptions {
  scaleResolution: boolean;
  capability?: HWCapability;
  preferredHW?: 'auto' | HWKind;
  codec?: ResolvedParams['codec'];
  container?: ResolvedParams['container'];
  target?: { resolution: number; fps: number; bitrateMbps: number };
  expert?: ResolvedParams;
}

const fpsClose = (a: number, b: number): boolean => Math.abs(a - b) < 0.05;

/** 判断所有片段参数是否一致（可 -c copy 直拼） */
export function areSegmentsUniform(segments: Segment[]): { equal: boolean; reason: string } {
  if (segments.length === 0) return { equal: false, reason: 'No segments' };
  if (segments.length === 1) return { equal: true, reason: 'Single segment' };

  const ref = segments[0].source;
  for (let i = 1; i < segments.length; i++) {
    const s = segments[i].source;
    if (segments[i].trim) return { equal: false, reason: 'Trimmed segments require re-encoding alignment' };
    if (s.height !== ref.height || s.width !== ref.width) {
      return {
        equal: false,
        reason: formatConcatReason('en', {
          equal: false,
          fromW: ref.width,
          fromH: ref.height,
          toW: s.width,
          toH: s.height,
          res: 0,
          fps: 0,
          bitrate: 0,
          codec: ''
        })
      };
    }
    if (!fpsClose(s.fps, ref.fps)) {
      return { equal: false, reason: `Frame rate mismatch (${ref.fps} vs ${s.fps})` };
    }
    if ((s.codec ?? '') !== (ref.codec ?? '')) {
      return { equal: false, reason: `Codec mismatch (${ref.codec} vs ${s.codec})` };
    }
    if (s.hasAudio !== ref.hasAudio) {
      return { equal: false, reason: 'Some clips are missing audio; silence padding is required' };
    }
    if (s.hasAudio && s.sampleRate !== AUDIO_UNIFY.sampleRate) {
      return { equal: false, reason: `Sample rate is not ${AUDIO_UNIFY.sampleRate}Hz; normalization is required` };
    }
  }
  if (segments[0].trim) return { equal: false, reason: 'Trimmed segments require re-encoding alignment' };
  return { equal: true, reason: formatConcatReason('en', { equal: true }) };
}

/** 计算统一参数（§7 统一配置 + C6 封顶） */
export function computeUniformParams(segments: Segment[], opts: PlanOptions): ResolvedParams {
  const sources = segments.map((s) => s.source).filter(Boolean) as SourceInfo[];
  const minHeight = Math.min(...sources.map((s) => s.height || 1080));
  const minFps = Math.min(...sources.map((s) => s.fps || TARGET.fps));
  const minBitrate = Math.min(
    ...sources.map((s) => (s.bitrateMbps && s.bitrateMbps > 0 ? s.bitrateMbps : Infinity))
  );

  const t = opts.target ?? TARGET;

  // 分辨率：绝不放大任何片段（C6）→ 取所有片段中的最小高度
  const resCap = capResolution(
    opts.scaleResolution ? t.resolution : minHeight,
    minHeight
  );
  const fpsCap = capFps(t.fps, minFps);

  const refSource =
    sources.find((s) => s.height === minHeight) ??
    sources.reduce((a, b) => (a.height <= b.height ? a : b));
  const ratio = refSource.height ? refSource.width / refSource.height : 16 / 9;
  const width = Math.round((resCap.value * ratio) / 2) * 2;

  const auto = computeAutoBitrate(
    width,
    resCap.value,
    Number.isFinite(minBitrate) ? minBitrate : undefined,
    t.bitrateMbps
  );

  const base: ResolvedParams = {
    resolution: resCap.value,
    fps: fpsCap.value,
    bitrateMbps: opts.scaleResolution
      ? Math.min(t.bitrateMbps, Number.isFinite(minBitrate) ? minBitrate : t.bitrateMbps)
      : auto.bitrateMbps,
    codec: opts.codec ?? (TARGET.codec as ResolvedParams['codec']),
    container: opts.container ?? 'mp4',
    audioCodec: 'aac',
    audioBitrateKbps: 192,
    sampleRate: AUDIO_UNIFY.sampleRate,
    channels: AUDIO_UNIFY.channels,
    capped: resCap.capped || fpsCap.capped || auto.cappedBySource,
    caps: {
      resolution: resCap.capped,
      bitrate: auto.cappedBySource,
      fps: fpsCap.capped
    }
  };

  if (opts.capability && base.codec !== 'copy') {
    // 与简单模式一致：交由决策树挑选硬件编码器
    const decision: SimpleDecision = decideSimple(refSource, {
      scaleResolution: opts.scaleResolution,
      codec: base.codec,
      container: base.container,
      capability: opts.capability,
      preferredHW: opts.preferredHW,
      target: t
    });
    base.hwCodec = decision.params?.hwCodec;
  }

  return opts.expert ?? base;
}

export function planConcat(segments: Segment[], opts: PlanOptions): ConcatPlan {
  const check = areSegmentsUniform(segments);
  const uniform = computeUniformParams(segments, opts);
  const totalDurationSec = segments.reduce((sum, s) => {
    const d = s.source?.durationSec ?? 0;
    if (!s.trim) return sum + d;
    const end = s.trim.endSec > 0 ? Math.min(s.trim.endSec, d) : d;
    return sum + Math.max(0, end - s.trim.startSec);
  }, 0);

  const silenceSegments = segments.filter((s) => !s.source?.hasAudio).map((s) => s.id);

  const strategy = check.equal ? 'copy' : 'transcode';
  const estimate: ConcatPlan['estimate'] =
    strategy === 'copy' ? 'fast' : totalDurationSec > 900 ? 'slow' : 'normal';

  const mismatch = !check.equal
    ? formatConcatReason('en', {
        equal: false,
        fromW: segments[0]?.source.width ?? 0,
        fromH: segments[0]?.source.height ?? 0,
        toW: segments.find((s) => s.source.width !== segments[0].source.width || s.source.height !== segments[0].source.height)?.source.width ?? segments[0]?.source.width ?? 0,
        toH: segments.find((s) => s.source.width !== segments[0].source.width || s.source.height !== segments[0].source.height)?.source.height ?? segments[0]?.source.height ?? 0,
        res: uniform.resolution,
        fps: uniform.fps,
        bitrate: uniform.bitrateMbps,
        codec: uniform.codec
      })
    : formatConcatReason('en', { equal: true });

  return {
    strategy,
    reason: mismatch,
    uniform,
    audio: {
      sampleRate: AUDIO_UNIFY.sampleRate,
      channels: AUDIO_UNIFY.channels,
      silenceOnMissing: AUDIO_UNIFY.silenceOnMissing
    },
    segments,
    silenceSegments,
    totalDurationSec: Math.round(totalDurationSec * 100) / 100,
    estimate
  };
}
