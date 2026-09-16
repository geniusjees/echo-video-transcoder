import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_UNIFY } from '@shared/constants';
import type { ConcatPlan, ResolvedParams, Segment } from '@shared/types';
import {
  buildTranscodeArgs,
  resolveVideoEncoder,
  type CommandContext
} from '../transcoder/commandBuilder';
import { ensureDir } from './segmentProbe';

/**
 * 拼接命令构建（§10.6）
 * - 纯拼接：concat demuxer + -c copy
 * - 转码对齐：每个片段先按统一参数转码（含音频统一 + 静音补齐），再 concat
 */

/** concat 清单文件中的路径转义 */
function escapeConcatPath(p: string): string {
  return p.replace(/'/g, "'\\''");
}

export function buildConcatListFile(segments: Segment[], workDir: string, fileName = 'concat.txt'): string {
  ensureDir(workDir);
  const file = path.join(workDir, fileName);
  const content = segments
    .map((s) => `file '${escapeConcatPath(path.resolve(s.input))}'`)
    .join('\n');
  fs.writeFileSync(file, `${content}\n`, 'utf-8');
  return file;
}

/** 纯拼接（-c copy，硬切直连，无转场） */
export function buildConcatCopyArgs(listFile: string, output: string): string[] {
  return [
    '-hide_banner',
    '-y',
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    output
  ];
}

/**
 * 片段转码对齐命令
 * 有音轨 → -c:a aac -b:a 192k -ar 48000 -ac 2
 * 无音轨 → -f lavfi -i anullsrc（补等长静音）+ -shortest
 */
export function buildSegmentAlignArgs(
  segment: Segment,
  output: string,
  uniform: ResolvedParams,
  ctx: CommandContext = {}
): string[] {
  const encoder = resolveVideoEncoder(uniform, ctx);
  const hasAudio = segment.source?.hasAudio ?? false;
  const trim = segment.trim;

  const args: string[] = ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats'];

  if (trim && trim.startSec > 0) args.push('-ss', String(trim.startSec));
  if (trim && trim.endSec > (trim.startSec ?? 0)) args.push('-to', String(trim.endSec));
  args.push('-i', segment.input);

  if (!hasAudio) {
    args.push(
      '-f',
      'lavfi',
      '-i',
      `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_UNIFY.sampleRate}`
    );
    args.push('-map', '0:v:0', '-map', '1:a:0', '-shortest');
  } else {
    args.push('-map', '0:v:0', '-map', '0:a:0?');
  }
  args.push('-sn', '-dn');

  args.push('-c:v', encoder);

  // 统一分辨率（绝不放大：低于源才缩放）
  if (uniform.resolution > 0 && segment.source && uniform.resolution < segment.source.height) {
    args.push('-vf', `scale=-2:${uniform.resolution}`);
  }
  if (uniform.fps > 0 && segment.source && uniform.fps < segment.source.fps) {
    args.push('-r', String(uniform.fps));
  }

  if (/^lib(x264|x265|vpx|vpx-vp9|svtav1)/.test(encoder)) {
    args.push(
      '-b:v',
      `${uniform.bitrateMbps}M`,
      '-maxrate',
      `${uniform.bitrateMbps}M`,
      '-bufsize',
      `${Math.round(uniform.bitrateMbps * 2 * 10) / 10}M`,
      '-pix_fmt',
      'yuv420p'
    );
  } else {
    args.push(
      '-b:v',
      `${uniform.bitrateMbps}M`,
      '-maxrate',
      `${uniform.bitrateMbps}M`,
      '-bufsize',
      `${Math.round(uniform.bitrateMbps * 2 * 10) / 10}M`
    );
  }

  // 音频统一（A 方案，强制）
  args.push(
    '-c:a',
    'aac',
    '-b:a',
    `${uniform.audioBitrateKbps}k`,
    '-ar',
    String(AUDIO_UNIFY.sampleRate),
    '-ac',
    String(AUDIO_UNIFY.channels)
  );

  args.push('-movflags', '+faststart');
  args.push(output);
  return args;
}

/** 生成转码对齐后的中间文件清单 */
export function buildAlignedListFile(outputs: string[], workDir: string): string {
  return buildConcatListFile(
    outputs.map((o) => ({ id: o, input: o, source: {} as never })),
    workDir,
    'concat_aligned.txt'
  );
}

/** 拼接整体命令预览（供 UI 折叠展示） */
export function buildConcatPreviewCommands(
  plan: ConcatPlan,
  workDir: string,
  output: string,
  ctx: CommandContext = {}
): string[] {
  if (plan.strategy === 'copy') {
    const list = buildConcatListFile(plan.segments, workDir);
    return [[`-f concat -safe 0 -i ${list} -c copy ${output}`].join(' ')];
  }
  const aligned = plan.segments.map((s, i) =>
    path.join(workDir, `seg_${String(i + 1).padStart(2, '0')}.conv.mp4`)
  );
  const cmds = plan.segments.map((s, i) =>
    buildSegmentAlignArgs(s, aligned[i], plan.uniform, ctx).join(' ')
  );
  cmds.push(`-f concat -safe 0 -i ${path.join(workDir, 'concat_aligned.txt')} -c copy ${output}`);
  return cmds;
}

export { buildTranscodeArgs };
