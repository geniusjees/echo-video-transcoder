import { AUDIO_UNIFY, TARGET } from '@shared/constants';
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
  if (segments.length === 0) return { equal: false, reason: '没有片段' };
  if (segments.length === 1) return { equal: true, reason: '单片段' };

  const ref = segments[0].source;
  for (let i = 1; i < segments.length; i++) {
    const s = segments[i].source;
    if (segments[i].trim) return { equal: false, reason: '存在片段裁剪，需重编码对齐' };
    if (s.height !== ref.height || s.width !== ref.width) {
      return { equal: false, reason: `分辨率不一致（${ref.width}×${ref.height} vs ${s.width}×${s.height}）` };
    }
    if (!fpsClose(s.fps, ref.fps)) {
      return { equal: false, reason: `帧率不一致（${ref.fps} vs ${s.fps}）` };
    }
    if ((s.codec ?? '') !== (ref.codec ?? '')) {
      return { equal: false, reason: `编码不一致（${ref.codec} vs ${s.codec}）` };
    }
    if (s.hasAudio !== ref.hasAudio) {
      return { equal: false, reason: '部分片段无音轨，需补静音对齐' };
    }
    if (s.hasAudio && s.sampleRate !== AUDIO_UNIFY.sampleRate) {
      return { equal: false, reason: `采样率非 ${AUDIO_UNIFY.sampleRate}Hz，需统一` };
    }
  }
  if (segments[0].trim) return { equal: false, reason: '存在片段裁剪，需重编码对齐' };
  return { equal: true, reason: '参数一致→纯拼接（硬切直连，-c copy）' };
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

  return {
    strategy,
    reason: check.equal
      ? check.reason
      : `${check.reason} → 转码对齐（统一 ${uniform.resolution}p / ${uniform.fps}fps / ${uniform.bitrateMbps}Mbps / ${uniform.codec.toUpperCase()}）`,
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
