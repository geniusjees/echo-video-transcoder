import { NOOP_RATE_BASE, REF_PIXELS, TARGET_CRF } from '@shared/constants';
import type { VideoCodec } from '@shared/types';

/**
 * 编码器画质配置（§9.3）
 *
 * 把统一的「画质意图」（H.265 CRF，普通/专家模式默认目标 26）翻译为各硬件编码器
 * 真正支持的参数。必须同时按 **显卡** 与 **操作系统** 区分：
 *
 * - `-crf` 只是 libx264/libx265 的私有选项，NVIDIA/QSV/AMD/VideoToolbox 都不认，
 *   需分别用 `-cq` / `-global_quality` / `-qp*` / `-q:v`；
 * - VideoToolbox 的 `-q:v`（恒定质量）**只在 Apple Silicon(arm64) 版 ffmpeg 上可用**
 *   （FFmpeg `libavcodec/videotoolboxenc.c` → `vtenc_qscale_enabled()`：
 *   `!TARGET_OS_IPHONE && TARGET_CPU_ARM64`）。x86_64 版 ffmpeg（Intel Mac，或
 *   Rosetta 下运行的 arm64 机器）会直接报
 *   `-q:v qscale not available for encoder. Use -b:v bitrate instead.`，
 *   导致整个任务失败 → 必须退回码率模式。
 */

export type EncoderKind = 'software' | 'nvenc' | 'qsv' | 'amf' | 'vaapi' | 'videotoolbox' | 'unknown';

export function isSoftwareEncoder(encoder: string): boolean {
  return /^lib(x264|x265|vpx|vpx-vp9|svtav1|aom-av1)/.test(encoder);
}

/** 按编码器名后缀判定厂商（由硬件侦测选出的 encoder 名决定） */
export function encoderKind(encoder: string): EncoderKind {
  if (isSoftwareEncoder(encoder)) return 'software';
  if (encoder.endsWith('_nvenc')) return 'nvenc';
  if (encoder.endsWith('_qsv')) return 'qsv';
  if (encoder.endsWith('_amf')) return 'amf';
  if (encoder.endsWith('_vaapi')) return 'vaapi';
  if (encoder.endsWith('_videotoolbox')) return 'videotoolbox';
  return 'unknown';
}

export function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 运行时环境：决定同一编码器在不同平台上的参数可用性 */
export interface QualityEnv {
  platform: NodeJS.Platform;
  /** VideoToolbox `-q:v` 恒定质量是否可用（macOS + arm64 版 ffmpeg） */
  vtConstantQuality: boolean;
}

export interface QualityIntent {
  /** > 0 表示恒定质量模式 */
  crf?: number;
  /**
   * 目标码率（Mbps）。
   * CRF 模式下为「等效码率」，仅当某硬件不支持恒定质量时用来兜底（如 x86_64 VideoToolbox）。
   */
  bitrateMbps: number;
}

// ---------------- VideoToolbox 恒定质量 ----------------

/** CRF26（本项目默认目标）对应的 `-q:v` 锚点 */
const VT_QSCALE_AT_CRF26 = 60;
/** CRF 每升高 1（画质要求降低），`-q:v` 约下降 1.5 */
const VT_QSCALE_PER_CRF = 1.5;

/**
 * CRF → videotoolbox 的 `-q:v`（0–100）。
 *
 * ⚠️ 方向与 x265 CRF / NVENC CQ **相反**：`-q:v` **越大画质越好**。
 * FFmpeg `videotoolboxenc.c` 中 `-q:v N` 被换算为
 * `Quality = clamp(N / 100, 0, 1)`，而 Apple `kVTCompressionPropertyKey_Quality`
 * 是 0.0–1.0、**越大越清晰**。锚点参考社区实测：
 * `-q:v` 50–60 ≈ NVENC CQ26–28 ≈ x265 CRF23–25。
 */
export function crfToVtQscale(crf: number): number {
  return clampInt(VT_QSCALE_AT_CRF26 - (crf - 26) * VT_QSCALE_PER_CRF, 1, 100);
}

// ---------------- CRF → 等效码率（不支持恒定质量的硬件兜底） ----------------

/**
 * CRF → 等效视频码率（Mbps）。
 *
 * 与体积预估（`renderer/utils/estimate.ts`）使用同一模型：以该编码 1080p 的
 * 基准码率为锚，CRF 每降 6 点码率约 ×2，并按源码率封顶（C6：不提升画质）。
 * 用于不支持恒定质量的硬件（如 x86_64 版 ffmpeg 的 VideoToolbox）。
 */
export function crfEquivalentBitrateMbps(opts: {
  codec: VideoCodec;
  width: number;
  height: number;
  crf: number;
  sourceBitrateMbps?: number;
}): number {
  const base = NOOP_RATE_BASE[opts.codec];
  if (!Number.isFinite(base)) return 0;
  const w = opts.width > 0 ? opts.width : 1920;
  const h = opts.height > 0 ? opts.height : 1080;
  const ratio = (w * h) / REF_PIXELS;
  const refCrf = TARGET_CRF[opts.codec] ?? TARGET_CRF.hevc;
  const raw = base * ratio * Math.pow(2, (refCrf - opts.crf) / 6);
  const capped =
    typeof opts.sourceBitrateMbps === 'number' && opts.sourceBitrateMbps > 0
      ? Math.min(raw, opts.sourceBitrateMbps)
      : raw;
  return Math.round(capped * 10) / 10;
}

// ---------------- 参数生成 ----------------

function bitrateArgs(kind: EncoderKind, mbps: number): string[] {
  if (!(mbps > 0)) return [];
  const b = Math.round(mbps * 10) / 10;
  const bufsize = Math.round(b * 2 * 10) / 10;
  const rate = ['-b:v', `${b}M`, '-maxrate', `${b}M`, '-bufsize', `${bufsize}M`];
  switch (kind) {
    case 'nvenc':
      return ['-rc', 'vbr', ...rate];
    case 'amf':
      return ['-rc', 'vbr_peak', ...rate];
    case 'vaapi':
      return ['-rc_mode', 'VBR', ...rate];
    default:
      return rate;
  }
}

/**
 * 按「显卡 + 系统」生成质量 / 码率参数。
 *
 * - CRF 模式：翻译为各硬件编码器的等效恒定质量参数；VideoToolbox 在不支持
 *   `-q:v` 的系统上退回等效码率，避免任务直接失败。
 * - 码率模式：生成各硬件编码器对应的码率参数。
 */
export function buildQualityArgs(
  kind: EncoderKind,
  intent: QualityIntent,
  env: QualityEnv
): string[] {
  const crf = typeof intent.crf === 'number' && intent.crf > 0 ? intent.crf : undefined;

  if (crf !== undefined) {
    switch (kind) {
      case 'software':
        return ['-crf', String(crf), '-preset', 'medium'];
      case 'nvenc':
        // NVENC：VBR + CQ（0–51，量级≈CRF），-b:v 0 = 纯恒定质量
        return ['-rc', 'vbr', '-cq', String(clampInt(crf, 0, 51)), '-b:v', '0'];
      case 'qsv':
        // QSV：ICQ 全局质量（1–51）
        return ['-global_quality', String(clampInt(crf, 1, 51))];
      case 'amf':
        // AMF：CQP（H.264/HEVC 的 QP 量级≈CRF）
        return [
          '-rc',
          'cqp',
          '-qp_i',
          String(clampInt(crf, 0, 51)),
          '-qp_p',
          String(clampInt(crf, 0, 51))
        ];
      case 'vaapi':
        return ['-rc_mode', 'CQP', '-qp', String(clampInt(crf, 0, 51))];
      case 'videotoolbox':
        if (env.platform === 'darwin' && env.vtConstantQuality) {
          return ['-q:v', String(crfToVtQscale(crf))];
        }
        // x86_64 版 ffmpeg：-q:v 不可用 → 退回等效码率
        return bitrateArgs('videotoolbox', intent.bitrateMbps);
      default:
        // 未知编码器：尽力而为（多数 ffmpeg 会忽略不认识的 -crf）
        return ['-crf', String(crf)];
    }
  }

  return bitrateArgs(kind, intent.bitrateMbps);
}
