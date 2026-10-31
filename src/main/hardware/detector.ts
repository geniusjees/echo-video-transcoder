import { execFile } from 'node:child_process';
import os from 'node:os';
import { pickEncoderName } from '@shared/params';
import type { HWCapability, HWKind } from '@shared/types';
import { ffmpegPath, machoCpuType } from '../utils/paths';

/** 执行一段命令并返回 stdout（失败返回空串） */
function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, windowsHide: true }, (err, stdout) => {
      resolve(err ? '' : String(stdout ?? ''));
    });
  });
}

/** 执行命令并返回退出码（0 = 成功） */
function runStatus(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000, windowsHide: true }, (err) => {
      if (!err) return resolve(0);
      const code = (err as { code?: unknown }).code;
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}

/**
 * 硬件编码器探测命令：用该编码器编码 1 帧黑画面到 null。
 * 成功（退出码 0）才说明「本机真的能用它」，仅出现在 `-encoders` 里是不够的。
 */
export function buildProbeArgs(encoder: string): string[] {
  const vaapi = encoder.endsWith('_vaapi');
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    ...(vaapi ? ['-vaapi_device', '/dev/dri/renderD128'] : []),
    '-f',
    'lavfi',
    '-i',
    // 探测帧必须大于硬件编码器的最小支持尺寸：NVENC 对 128×128 会直接报
    // "Frame dimensions are less than the minimum supported value"(-22)，
    // 从而把「硬件可用」误判成不可用。
    'color=c=black:s=640x480:r=1',
    '-frames:v',
    '1',
    ...(vaapi ? ['-vf', 'format=nv12,hwupload'] : ['-pix_fmt', 'nv12']),
    '-c:v',
    encoder,
    '-f',
    'null',
    '-'
  ];
}

/** 真实探测某个硬件编码器是否可用（编码一帧，成功即视为本机可用） */
async function probeHardwareEncoder(encoder: string): Promise<boolean> {
  const bin = ffmpegPath();
  if (!bin) return false;
  try {
    return (await runStatus(bin, buildProbeArgs(encoder))) === 0;
  } catch {
    return false;
  }
}

/**
 * 每个厂商的候选编码器（按优先级）。
 * 有些老显卡只支持 H.264 NVENC（无 HEVC/AV1），所以任一候选成功即认为该厂商可用，
 * 并把真实可用的编码器名记入 `probedEncoders`，供选编码器时精确判断。
 */
const PROBE_ENCODERS: Record<'nvenc' | 'qsv' | 'amf' | 'videotoolbox' | 'vaapi', string[]> = {
  nvenc: ['hevc_nvenc', 'h264_nvenc', 'av1_nvenc'],
  qsv: ['hevc_qsv', 'h264_qsv', 'av1_qsv'],
  amf: ['hevc_amf', 'h264_amf', 'av1_amf'],
  videotoolbox: ['hevc_videotoolbox', 'h264_videotoolbox'],
  vaapi: ['hevc_vaapi', 'h264_vaapi']
};

type HwFamily = keyof typeof PROBE_ENCODERS;

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

  // `ffmpeg -encoders` 只反映「编译进来」的编码器（标准构建在没有对应硬件的机器上
  // 也会列出 nvenc/qsv/amf…），若据此判定可用 → 选项灰不掉、且实际编码会失败。
  // 因此对每个厂商实际编码 1 帧来做真实探测（并行执行）。
  const compiled = {
    nvenc: /nvenc/i.test(encoders),
    qsv: /_qsv\b/i.test(encoders),
    amf: /_amf\b/i.test(encoders),
    videotoolbox: /videotoolbox/i.test(encoders),
    vaapi: /vaapi/i.test(encoders)
  };
  // 只探测「编译进来 + 平台相关」的厂商，避免无谓的 ffmpeg 进程
  const familyApplicable: Record<HwFamily, boolean> = {
    nvenc: compiled.nvenc,
    qsv: compiled.qsv,
    amf: compiled.amf,
    videotoolbox: platform === 'darwin' && compiled.videotoolbox,
    vaapi: platform === 'linux' && compiled.vaapi
  };

  const candidates = (Object.keys(PROBE_ENCODERS) as HwFamily[]).flatMap((fam) =>
    familyApplicable[fam] ? PROBE_ENCODERS[fam].map((name) => ({ fam, name })) : []
  );
  const probed = await Promise.all(
    candidates.map(async (c) => ({ ...c, ok: await probeHardwareEncoder(c.name) }))
  );
  const working = probed.filter((p) => p.ok);
  const hasFamily = (fam: HwFamily): boolean => working.some((p) => p.fam === fam);

  const cap: HWCapability = {
    nvenc: hasFamily('nvenc'),
    qsv: hasFamily('qsv'),
    amf: hasFamily('amf'),
    videotoolbox: hasFamily('videotoolbox'),
    vaapi: hasFamily('vaapi'),
    mps: false,
    recommended: 'software',
    platform,
    arch,
    encoders: parseEncoderNames(encoders),
    probedEncoders: working.map((p) => p.name)
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

    // 本机 ffmpeg 二进制的真实架构：决定 VideoToolbox 能否使用 `-q:v` 恒定质量。
    // 该选项只在 arm64 构建中启用（FFmpeg vtenc_qscale_enabled()），x86_64 构建
    // （Intel Mac / Rosetta 下运行）会直接报错 → 需退回码率模式。
    const hostArch: 'arm64' | 'x86_64' =
      machine === 'arm64' || arch === 'arm64' ? 'arm64' : 'x86_64';
    cap.ffmpegArch = machoCpuType(ffmpegPath()) ?? hostArch;
    cap.vtConstantQuality = cap.ffmpegArch === 'arm64';
  } else {
    cap.ffmpegArch = 'unknown';
    cap.vtConstantQuality = false;
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
