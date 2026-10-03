import { AUDIO_ENCODERS, SW_FALLBACK } from '@shared/constants';
import type { HWCapability, HWKind, ResolvedParams, SourceInfo, TaskPayload } from '@shared/types';
import { pickEncoder } from '../hardware/detector';
import {
  buildQualityArgs,
  crfEquivalentBitrateMbps,
  encoderKind,
  isSoftwareEncoder,
  type QualityEnv
} from './encoderProfile';

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

/** 旋转/翻转重编码时的默认质量（各编码器按显卡/系统各自映射） */
const ROTATE_CRF = 20;

/** 旋转/翻转任务拿不到源信息时的占位（用于估算等效码率） */
const ROTATE_FALLBACK_SOURCE: SourceInfo = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationSec: 0,
  codec: 'hevc',
  hasAudio: false
};

/** 由硬件能力推导运行时画质环境（缺省 = 非 macOS，VideoToolbox 无恒定质量） */
function qualityEnv(ctx: CommandContext): QualityEnv {
  const cap = ctx.capability;
  return {
    platform: cap?.platform ?? process.platform,
    vtConstantQuality: Boolean(cap?.vtConstantQuality)
  };
}

/**
 * 按「显卡 + 系统」把画质意图翻译为质量 / 码率参数（实现见 encoderProfile，§9.3）。
 * - CRF 模式：各硬件编码器翻译为等效恒定质量参数；VideoToolbox 在不支持 `-q:v`
 *   的系统（x86_64 版 ffmpeg）上退回等效码率，避免任务失败；
 * - 码率模式：生成各硬件编码器对应的码率参数。
 */
function encodeQualityArgs(
  encoder: string,
  params: ResolvedParams,
  source: SourceInfo,
  env: QualityEnv
): string[] {
  const kind = encoderKind(encoder);
  const crf = typeof params.crf === 'number' && params.crf > 0 ? params.crf : undefined;
  // CRF 模式下的等效码率：供不支持恒定质量的硬件（x86_64 VideoToolbox）兜底
  const bitrateMbps =
    params.bitrateMbps > 0
      ? params.bitrateMbps
      : crf !== undefined
        ? crfEquivalentBitrateMbps({
            codec: params.codec,
            width: source.width,
            height: source.height,
            crf,
            sourceBitrateMbps: source.bitrateMbps
          })
        : 0;
  return buildQualityArgs(kind, { crf, bitrateMbps }, env);
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
    args.push(...encodeQualityArgs(encoder, params, source, qualityEnv(ctx)));
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
  ctx: CommandContext = {},
  source: SourceInfo = ROTATE_FALLBACK_SOURCE
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

  const rotateParams = { codec: 'hevc', crf: ROTATE_CRF, bitrateMbps: 0 } as ResolvedParams;
  const encoder = resolveVideoEncoder(rotateParams, ctx);
  const env = qualityEnv(ctx);

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
    ...encodeQualityArgs(encoder, rotateParams, source, env),
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
      return buildRotateArgs(payload.input, payload.output, payload.rotate!, ctx, source);
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
