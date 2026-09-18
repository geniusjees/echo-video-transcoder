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
    filters.push(`trim=start=${start}:end=${end}`);
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
    if (typeof params.crf === 'number' && isSoftwareEncoder(encoder)) {
      args.push('-crf', String(params.crf), '-preset', 'medium');
    } else if (params.bitrateMbps > 0) {
      args.push(
        '-b:v',
        `${params.bitrateMbps}M`,
        '-maxrate',
        `${params.bitrateMbps}M`,
        '-bufsize',
        `${Math.round(params.bitrateMbps * 2 * 10) / 10}M`
      );
    }
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
    ...(isSoftwareEncoder(encoder) ? ['-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium'] : ['-b:v', '0', '-q:v', '60']),
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
    backgroundAudio?: { input: string; originalVolume: number; backgroundVolume: number };
  },
  source: SourceInfo,
  ctx: CommandContext = {}
): string[] {
  const args: string[] = ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats'];
  if (opts.trimStartSec && opts.trimStartSec > 0) args.push('-ss', String(opts.trimStartSec));
  if (opts.trimEndSec && opts.trimEndSec > (opts.trimStartSec ?? 0)) args.push('-to', String(opts.trimEndSec + (opts.trimStartSec ?? 0)));
  args.push('-i', input);

  const bgInput = opts.backgroundAudio?.input;
  if (bgInput) args.push('-i', bgInput);

  const filters = buildEditVideoFilters({
    trimStartSec: opts.trimStartSec,
    trimEndSec: opts.trimEndSec,
    rotation: opts.rotation,
    cutSegments: opts.cutSegments
  });
  const needsReencode = Boolean(filters.length) || Boolean(opts.transcode) || Boolean(bgInput);

  if (needsReencode) {
    args.push('-map', '0:v:0');
    if (filters.length) args.push('-vf', filters.join(','));
    if (bgInput) {
      args.push('-filter_complex', buildEditAudioFilter(opts.backgroundAudio));
      args.push('-map', '[aout]');
    } else {
      args.push('-map', '0:a:0?');
    }
    args.push('-sn', '-dn', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p');
    if (!bgInput) args.push('-c:a', 'aac', '-movflags', '+faststart');
    else args.push('-c:a', 'aac', '-shortest', '-movflags', '+faststart');
  } else {
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-c', 'copy');
  }

  if (bgInput && !filters.length) {
    args.push('-filter_complex', buildEditAudioFilter(opts.backgroundAudio));
    args.push('-map', '[aout]');
    args.push('-shortest', '-c:a', 'aac');
  }

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
          transcode: payload.edit?.transcode,
          backgroundAudio: payload.edit?.backgroundAudio
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
