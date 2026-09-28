import { execFile } from 'node:child_process';
import os from 'node:os';
import { pickEncoderName } from '@shared/params';
import type { HWCapability, HWKind } from '@shared/types';
import { ffmpegPath } from '../utils/paths';

/** 执行一段命令并返回 stdout（失败返回空串） */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : String(stdout ?? ''));
    });
  });
}

/**
 * 返回 `ffmpeg -encoders` 的原始输出
 *
 * 注意：ffmpegPath() 在未随包分发时会回退为裸命令名（依赖系统 PATH，Windows 常见），
 * 此路径 fs.existsSync 必然为 false，若据此提前返回会把「系统已安装 ffmpeg」
 * 误判成「无 ffmpeg」，导致硬件侦测恒为软件编码。因此这里直接执行、由失败兜底。
 */
async function getEncoders(): Promise<string> {
  const bin = ffmpegPath();
  if (!bin) return '';
  return run(bin, ['-hide_banner', '-encoders']);
}

/**
 * 显卡自动侦测（C4，含 Apple MPS）
 * Windows: NVENC / QSV / AMF；macOS: VideoToolbox，Apple Silicon → MPS
 */
export async function detect(): Promise<HWCapability> {
  const encoders = await getEncoders();
  const platform = process.platform;
  const arch = os.arch();

  const cap: HWCapability = {
    nvenc: /nvenc/i.test(encoders),
    qsv: /_qsv\b/i.test(encoders),
    amf: /_amf\b/i.test(encoders),
    videotoolbox: /videotoolbox/i.test(encoders),
    vaapi: /vaapi/i.test(encoders),
    mps: false,
    recommended: 'software',
    platform,
    arch,
    encoders: parseEncoderNames(encoders)
  };

  if (platform === 'darwin') {
    let machine = arch;
    try {
      machine = (await run('uname', ['-m'])).trim() || arch;
    } catch {
      /* ignore */
    }
    // Apple Silicon (arm64) + VideoToolbox → 认定具备 MPS 加速（§9.1）
    cap.mps = (machine === 'arm64' || arch === 'arm64') && cap.videotoolbox;
  }

  cap.recommended = pickRecommended(cap);
  return cap;
}

/** 从 `ffmpeg -encoders` 输出中提取编码器名 */
function parseEncoderNames(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[VAS\.]/.test(line))
    .map((line) => line.split(/\s+/)[1])
    .filter((name): name is string => Boolean(name));
}

export function pickRecommended(cap: HWCapability): HWKind {
  if (cap.nvenc) return 'nvenc';
  if (cap.qsv) return 'qsv';
  if (cap.videotoolbox) return cap.mps ? 'videotoolbox-mps' : 'videotoolbox';
  if (cap.amf) return 'amf';
  if (cap.vaapi) return 'vaapi';
  return 'software';
}

let cachedCap: HWCapability | null = null;

export async function detectCached(force = false): Promise<HWCapability> {
  if (!force && cachedCap) return cachedCap;
  cachedCap = await detect();
  return cachedCap;
}

/** 选择实际可用的编码器名；不可用时降级软件（§9.3）—— 实现见 @shared/params */
export function pickEncoder(
  cap: HWCapability,
  codec: 'hevc' | 'h264' | 'av1' | 'vp9',
  preferred: 'auto' | HWKind = 'auto'
): { encoder: string; hw: HWKind; fellBack: boolean } {
  return pickEncoderName(cap, codec, preferred);
}
