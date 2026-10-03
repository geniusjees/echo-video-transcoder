import { AUDIO_ENCODERS, SW_FALLBACK } from '@shared/constants';
import type { HWCapability, HWKind, ResolvedParams, SourceInfo, TaskPayload } from '@shared/types';
import { pickEncoder } from '../hardware/detector';

/**
 * FFmpeg 命令构建（§10）
 * 所有参数经 capRule 封顶后才进入此模块；ffmpeg 路径始终指向应用根目录（C5）。
 */

export interface CommandContext {
  capability?: HWCapability;
  preferredHW?: 'auto' | HWKind;
  extraArgs?: string[];
}

/** 选定实际视频编码器：硬件优先，不支持则软件兜底（§9.3） */
export function resolveVideoEncoder(params: ResolvedParams, ctx: CommandContext): string {
  if (params.codec === 'copy') return 'copy';
  if (params.hwCodec) return params.hwCodec;
  if (ctx.capability) {
    const { encoder } = pickEncoder(ctx.capability, params.codec, ctx.preferredHW ?? 'auto');
    return encoder;
  }
  return SW_FALLBACK[params.codec];
}

function isSoftwareEncoder(encoder: string): boolean {
  return /^lib(x264|x265|vpx|vpx-vp9|svtav1|aom-av1)/.test(encoder);
}

/** 编码器厂商分类（由硬件侦测选出的 encoder 名决定，§9.3） */
type EncoderKind = 'software' | 'nvenc' | 'qsv' | 'amf' | 'vaapi' | 'videotoolbox' | 'unknown';

function encoderKind(encoder: string): EncoderKind {
  if (isSoftwareEncoder(encoder)) return 'software';
  if (encoder.endsWith('_nvenc')) return 'nvenc';
  if (encoder.endsWith('_qsv')) return 'qsv';
  if (encoder.endsWith('_amf')) return 'amf';
  if (encoder.endsWith('_vaapi')) return 'vaapi';
  if (encoder.endsWith('_videotoolbox')) return 'videotoolbox';
  return 'unknown';
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** VideoToolbox `-q:v`（0–100，越大越好）与 CRF 的近似换算 */
function crfToVtQuality(crf: number): number {
  return clampInt(100 - crf * 1.6, 1, 100);
}

/** 旋转/翻转重编码时的默认质量（仅软件/硬件各自映射） */
const ROTATE_CRF = 20;

/**
 * 按编码器类型把「画质意图」翻译为对应的质量 / 码率参数。
 * - CRF 模式（普通模式 + 专家模式 crf）：翻译为各硬件编码器的等效恒定质量参数；
 *   `-crf` 只是 libx264/libx265 的私有选项，硬件编码器一律不认，必须换各自参数。
 * - 码率模式（专家模式 cbr/vbr）：生成各硬件编码器对应的码率参数。
 */
function encodeQualityArgs(encoder: string, params: ResolvedParams): string[] {
  const kind = encoderKind(encoder);
  const crf = typeof params.crf === 'number' && params.crf > 0 ? params.crf : undefined;

  if (crf !== undefined) {
    switch (kind) {
      case 'software':
        return ['-crf', String(crf), '-preset', 'medium'];
      case 'nvenc':
        // NVENC：VBR + CQ（0–51，量级≈CRF），-b:v 0 表示纯恒定质量
        return ['-rc', 'vbr', '-cq', String(clampInt(crf, 0, 51)), '-b:v', '0'];
      case 'qsv':
        // QSV：ICQ 全局质量（1–51）
        return ['-global_quality', String(clampInt(crf, 1, 51))];
      case 'amf':
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
        return ['-q:v', String(crfToVtQuality(crf))];
      default:
        // 未知编码器：尽力而为（多数 ffmpeg 会忽略不认识的 -crf）
        return ['-crf', String(crf)];
    }
  }

  const mbps = params.bitrateMbps;
  if (mbps > 0) {
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

  return [];
}

function audioArgs(params: ResolvedParams, withAudioBitrate = true): string[] {
  if (params.audioCodec === 'none') return ['-an'];
  const encoder = AUDIO_ENCODERS[params.audioCodec];
  if (!encoder) return ['-an'];
  const args: string[] = ['-c:a', encoder];
  // flac / pcm 不接受 -b:a
  if (withAudioBitrate && params.audioCodec !== 'flac' && params.audioCodec !== 'wav') {
    args.push('-b:a', `${params.audioBitrateKbps}k`);
  }
  if (params.sampleRate) args.push('-ar', String(params.sampleRate));
  if (params.channels) args.push('-ac', String(params.channels));
  return args;
}

function trimArgs(trim?: { startSec: number; endSec: number }): string[] {
  if (!trim) return [];
  const args: string[] = [];
  if (trim.startSec > 0) args.push('-ss', String(trim.startSec));
  if (trim.endSec > trim.startSec) args.push('-to', String(trim.endSec));
  return args;
}

function buildEditVideoFilters(opts: {
  trimStartSec?: number;
  trimEndSec?: number;
  rotation?: { mode: 0 | 90 | 180 | 270; flip: 'none' | 'horizontal' | 'vertical'; metadataOnly?: boolean };
  cutSegments?: Array<{ startSec: number; endSec: number }>;
}): string[] {
  const filters: string[] = [];

  if (opts.trimStartSec !== undefined || opts.trimEndSec !== undefined) {
    const start = opts.trimStartSec ?? 0;
    const end = opts.trimEndSec ?? Number.MAX_SAFE_INTEGER;
    if (start > 0 && end < Number.MAX_SAFE_INTEGER) {
      // 中间保留段由 ffmpeg 的 -ss/-t 处理，避免使用错误的绝对时间轴导致时长偏移和卡顿。
    }
  }

  if (opts.rotation?.mode === 90) filters.push('transpose=1');
  else if (opts.rotation?.mode === 180) filters.push('transpose=2,transpose=2');
  else if (opts.rotation?.mode === 270) filters.push('transpose=2');

  if (opts.rotation?.flip === 'horizontal') filters.push('hflip');
  if (opts.rotation?.flip === 'vertical') filters.push('vflip');

  if (opts.cutSegments?.length) {
    const expr = opts.cutSegments
      .map((seg) => `between(t,${seg.startSec},${seg.endSec})`)
      .join('+');
    filters.push(`select='not(${expr})'`);
    filters.push('setpts=N/FRAME_RATE/TB');
  }

  return filters;
}

function buildEditAudioFilter(opts?: { input: string; originalVolume: number; backgroundVolume: number }): string {
  if (!opts) return '';
  return `[0:a]volume=${opts.originalVolume}[a0];[1:a]volume=${opts.backgroundVolume}[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[aout]`;
}

function buildFilters(
  source: SourceInfo,
  params: ResolvedParams,
  extraFilters: string[] = []
): string[] {
  const filters = [...extraFilters];
  // 只在目标高度低于源高度时缩放（C6：绝不放大）
  if (params.resolution > 0 && source.height > 0 && params.resolution < source.height) {
    filters.push(`scale=-2:${params.resolution}`);
  }
  return filters.length ? ['-vf', filters.join(',')] : [];
}

/** 转码 / 专家模式 */
export function buildTranscodeArgs(
  input: string,
  output: string,
  params: ResolvedParams,
  source: SourceInfo,
  ctx: CommandContext = {},
  trim?: { startSec: number; endSec: number }
): string[] {
  const encoder = resolveVideoEncoder(params, ctx);
  const args: string[] = [
    '-hide_banner',
    '-y',
    '-progress',
    'pipe:1',
    '-nostats',
    ...trimArgs(trim),
    '-i',
    input
  ];

  args.push('-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn');

  if (params.codec === 'copy') {
    args.push('-c:v', 'copy');
  } else {
    args.push('-c:v', encoder);
    args.push(...buildFilters(source, params));
    if (params.fps > 0 && source.fps > 0 && params.fps < source.fps) {
      args.push('-r', String(params.fps));
    }
    args.push(...encodeQualityArgs(encoder, params));
    if (isSoftwareEncoder(encoder)) args.push('-pix_fmt', 'yuv420p');
  }

  args.push(...audioArgs(params));

  if (params.container === 'mp4' || params.container === 'mov') {
    args.push('-movflags', '+faststart');
  }
  if (ctx.extraArgs?.length) args.push(...sanitizeExtraArgs(ctx.extraArgs));
  args.push(output);
  return args;
}

/** 旋转 / 翻转：优先元数据（不重编码），翻转必须重编码（§10.4） */
export function buildRotateArgs(
  input: string,
  output: string,
  opts: { mode: 0 | 90 | 180 | 270; flip: 'none' | 'horizontal' | 'vertical'; metadataOnly: boolean },
  ctx: CommandContext = {}
): string[] {
  const metadataArgs: string[] = [
    '-hide_banner',
    '-y',
    '-progress',
    'pipe:1',
    '-nostats',
    '-i',
    input,
    '-c',
    'copy',
    '-metadata:s:v:0',
    `rotate=${opts.mode}`,
    output
  ];

  // 无翻转时，优先用元数据旋转（不重编码，秒级完成）
  if (opts.metadataOnly && opts.flip === 'none') {
    return metadataArgs;
  }

  const filters: string[] = [];
  if (opts.mode === 90) filters.push('transpose=1');
  else if (opts.mode === 180) filters.push('transpose=2,transpose=2');
  else if (opts.mode === 270) filters.push('transpose=2');
  if (opts.flip === 'horizontal') filters.push('hflip');
  if (opts.flip === 'vertical') filters.push('vflip');

  const encoder = resolveVideoEncoder({ codec: 'hevc', bitrateMbps: 0 } as ResolvedParams, ctx);

  return [
    '-hide_banner',
    '-y',
    '-progress',
    'pipe:1',
    '-nostats',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-sn',
    '-dn',
    ...(filters.length ? ['-vf', filters.join(',')] : []),
    '-c:v',
    encoder,
    ...encodeQualityArgs(encoder, { crf: ROTATE_CRF, bitrateMbps: 0 } as ResolvedParams),
    ...(isSoftwareEncoder(encoder) ? ['-pix_fmt', 'yuv420p'] : []),
    '-c:a',
    'copy',
    '-metadata:s:v:0',
    'rotate=0',
    '-movflags',
    '+faststart',
    output
  ];
}

/** 音频提取（§10.5） */
export function buildAudioExtractArgs(
  input: string,
  output: string,
  opts: {
    codec: ResolvedParams['audioCodec'];
    bitrateKbps: number;
    sampleRate: number;
    channels: number;
    startSec?: number;
    endSec?: number;
  }
): string[] {
  const encoder = AUDIO_ENCODERS[opts.codec] ?? 'aac';
  const args: string[] = ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats'];
  if (opts.startSec && opts.startSec > 0) args.push('-ss', String(opts.startSec));
  if (opts.endSec && opts.endSec > (opts.startSec ?? 0)) args.push('-to', String(opts.endSec));
  args.push('-i', input, '-vn', '-sn', '-dn', '-c:a', encoder);
  if (opts.codec !== 'flac' && opts.codec !== 'wav') args.push('-b:a', `${opts.bitrateKbps}k`);
  args.push('-ar', String(opts.sampleRate), '-ac', String(opts.channels));
  args.push(output);
  return args;
}

/** 按任务类型分派构建 */
export function buildEditArgs(
  input: string,
  output: string,
  opts: {
    trimStartSec?: number;
    trimEndSec?: number;
    cutSegments?: Array<{ startSec: number; endSec: number }>;
    rotation?: { mode: 0 | 90 | 180 | 270; flip: 'none' | 'horizontal' | 'vertical'; metadataOnly?: boolean };
    transcode?: boolean;
  },
  source: SourceInfo,
  ctx: CommandContext = {}
): string[] {
  const args: string[] = ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats'];
  const hasCutSegments = Boolean(opts.cutSegments?.length);
  const trimStart = !hasCutSegments && typeof opts.trimStartSec === 'number' ? opts.trimStartSec : undefined;
  const trimEnd = !hasCutSegments && typeof opts.trimEndSec === 'number' ? opts.trimEndSec : undefined;

  const filters = buildEditVideoFilters({
    trimStartSec: hasCutSegments ? undefined : opts.trimStartSec,
    trimEndSec: hasCutSegments ? undefined : opts.trimEndSec,
    rotation: opts.rotation,
    cutSegments: opts.cutSegments
  });
  const isSimpleTrim = !hasCutSegments && !filters.length && !opts.transcode;

  if (typeof trimStart === 'number' && trimStart > 0) {
    args.push('-ss', String(trimStart));
  }
  args.push('-i', input);

  if (typeof trimEnd === 'number' && trimEnd > (trimStart ?? 0)) {
    const duration = trimEnd - (trimStart ?? 0);
    args.push('-t', String(Math.max(duration, 0)));
  }

  if (isSimpleTrim) {
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart');
    args.push(output);
    return args;
  }

  if (filters.length) args.push('-vf', filters.join(','));
  args.push('-map', '0:v:0', '-map', '0:a:0?');
  args.push('-sn', '-dn', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p');
  args.push('-c:a', 'aac', '-movflags', '+faststart', '-avoid_negative_ts', 'make_zero');

  args.push(output);
  return args;
}

export function buildArgsForTask(
  payload: TaskPayload,
  source: SourceInfo,
  ctx: CommandContext = {}
): string[] {
  switch (payload.kind) {
    case 'transcode':
      return buildTranscodeArgs(
        payload.input,
        payload.output,
        payload.params!,
        source,
        ctx,
        payload.trim
      );
    case 'rotate':
      return buildRotateArgs(payload.input, payload.output, payload.rotate!, ctx);
    case 'extractAudio':
      return buildAudioExtractArgs(payload.input, payload.output, payload.audio!);
    case 'edit':
      return buildEditArgs(
        payload.input,
        payload.output,
        {
          trimStartSec: payload.edit?.trimStartSec,
          trimEndSec: payload.edit?.trimEndSec,
          cutSegments: payload.edit?.cutSegments,
          rotation: payload.edit?.rotation,
          transcode: payload.edit?.transcode
        },
        source,
        ctx
      );
    default:
      throw new Error(`不支持的任务类型：${payload.kind}`);
  }
}

/** extraArgs 白名单校验，防参数注入（§17.2） */
const ALLOWED_PREFIX = /^-[a-zA-Z0-9_.:+-]+$/;
const DENY_LIST = ['-i', '-f', '-y', '-progress'];

export function sanitizeExtraArgs(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (!ALLOWED_PREFIX.test(a)) continue;
    if (DENY_LIST.includes(a)) continue;
    out.push(a);
  }
  return out;
}

/** 生成可读命令预览（C7） */
export function toCommandString(bin: string, args: string[]): string {
  const quote = (s: string) => (/\s|'/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  return [quote(bin), ...args.map(quote)].join(' ');
}
