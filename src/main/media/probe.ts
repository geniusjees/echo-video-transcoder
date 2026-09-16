import { execFile } from 'node:child_process';
import fs from 'node:fs';
import type { SourceInfo } from '@shared/types';
import { ffmpegPath, ffprobePath } from '../utils/paths';

interface ProbeStream {
  codec_name?: string;
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  bit_rate?: string;
  tags?: Record<string, unknown>;
}

interface ProbeResult {
  streams?: ProbeStream[];
  format?: { duration?: string; bit_rate?: string; size?: string; format_name?: string };
}

function execJson(file: string, args: string[]): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 30000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(String(stdout)));
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

function parseRate(rate?: string): number {
  if (!rate) return 0;
  const [num, den] = rate.split('/');
  const n = Number(num);
  const d = Number(den);
  if (!n || !d) return 0;
  return Math.round((n / d) * 1000) / 1000;
}

/**
 * ffprobe 探针：获取分辨率 / 码率 / 帧率 / 时长 / 音轨信息
 * 拿不到码率时返回 undefined（不做封顶，§7.1）
 */
export async function probe(input: string, configuredProbe?: string): Promise<SourceInfo> {
  const bin = ffprobePath(configuredProbe);
  const data = await execJson(bin, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    input
  ]);

  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video') ?? streams[0];
  const audio = streams.find((s) => s.codec_type === 'audio');

  const width = Number(video?.width ?? 0);
  const height = Number(video?.height ?? 0);

  const fpsRaw = parseRate(video?.avg_frame_rate) || parseRate(video?.r_frame_rate);
  const fps = fpsRaw > 0 ? Math.round(fpsRaw * 100) / 100 : 0;

  const bitRateFromFormat = Number(data.format?.bit_rate ?? 0);
  const bitRateFromVideo = Number(video?.bit_rate ?? 0);
  const bitrate =
    bitRateFromVideo || bitRateFromFormat
      ? Math.round(((bitRateFromVideo || bitRateFromFormat) / 1_000_000) * 100) / 100
      : undefined;

  const durationSec = Math.max(
    Number(data.format?.duration ?? 0) || Number(video?.duration ?? 0) || 0,
    0
  );

  // 元数据旋转 90/270 时宽高需互换（§10.4）
  let w = width;
  let h = height;
  const rotateTag = Number((video?.tags as Record<string, string>)?.rotate ?? 0);
  if (rotateTag === 90 || rotateTag === 270) {
    w = height;
    h = width;
  }

  return {
    width: w,
    height: h,
    fps,
    bitrateMbps: bitrate,
    durationSec,
    codec: String(video?.codec_name ?? ''),
    hasAudio: Boolean(audio),
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
    channels: audio?.channels ?? undefined,
    audioCodec: audio?.codec_name,
    fileSizeBytes: Number(data.format?.size ?? 0) || fsSafeSize(input)
  };
}

function fsSafeSize(input: string): number {
  try {
    return fs.statSync(input).size;
  } catch {
    return 0;
  }
}

/** 生成缩略图（dataURL），用于片段预览（§13.4） */
export async function thumbnail(
  input: string,
  seekSec = 1,
  configuredFfmpeg?: string
): Promise<string> {
  const bin = ffmpegPath(configuredFfmpeg);
  return new Promise((resolve) => {
    execFile(
      bin,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        String(seekSec),
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        'scale=240:-2',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1'
      ],
      { encoding: 'buffer', timeout: 30000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout || !(stdout as Buffer).length) return resolve('');
        resolve(`data:image/jpeg;base64,${(stdout as Buffer).toString('base64')}`);
      }
    );
  });
}
