import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 应用根目录：开发态 = 项目根；打包后 = 主进程可执行文件所在目录（§5.1）
 * Win: .../VideoTranscoder/   Mac: .../xxx.app/Contents/MacOS
 */
export function appRoot(): string {
  if (app.isPackaged) return path.dirname(process.execPath);
  return process.cwd();
}

export const configPath = (): string => path.join(appRoot(), 'config.json');

/** 配置回退目录（根目录只读时，如 Program Files） */
export const userDataPath = (): string => app.getPath('userData');

export const fallbackConfigPath = (): string => path.join(userDataPath(), 'config.json');

/** 本应用依赖的 FFmpeg 二进制（ffplay 已移除，详见 REQUIRED_BINS 注释） */
export type BinName = 'ffmpeg' | 'ffprobe';

const BIN_NAME = (name: BinName): string =>
  process.platform === 'win32' ? `${name}.exe` : name;

/** 是否为真实文件（存在且是文件）—— 不能是同名目录，如仓库根的 ffmpeg/ */
function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 平台子目录别名（本仓库布局：ffmpeg/bin/<alias>/<bin>，如 ffmpeg/bin/mac/ffmpeg） */
function platformAliases(): string[] {
  if (process.platform === 'darwin') return ['mac', 'darwin', 'osx'];
  if (process.platform === 'win32') return ['win', 'windows'];
  return ['linux'];
}

/** 二进制搜索候选目录（越靠前优先级越高） */
function candidateDirs(): string[] {
  const root = appRoot();
  const bases = [
    root,
    path.join(root, 'ffmpeg', 'bin'),
    path.join(root, 'ffmpeg'),
    path.join(root, 'resources'),
    path.join(root, 'resources', 'ffmpeg', 'bin')
  ];
  // macOS 打包后 extraResources 位于 Contents/Resources
  if (process.resourcesPath) {
    bases.push(process.resourcesPath, path.join(process.resourcesPath, 'ffmpeg', 'bin'));
  }
  // 开发态兜底
  const cwd = process.cwd();
  bases.push(path.join(cwd, 'ffmpeg', 'bin'), path.join(cwd, 'ffmpeg'), cwd);

  const dirs: string[] = [];
  for (const base of bases) {
    // 平台子目录优先（ffmpeg/bin/mac/ffmpeg），再退回本级（ffmpeg/bin/ffmpeg）
    for (const alias of platformAliases()) dirs.push(path.join(base, alias));
    dirs.push(base);
  }

  // 系统包管理器安装位置：GUI/Finder 启动的 Electron 常缺少 Homebrew 的 PATH
  if (process.platform === 'darwin') {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin');
  } else if (process.platform === 'linux') {
    dirs.push('/usr/local/bin', '/usr/bin', '/bin', '/snap/bin');
  }
  return Array.from(new Set(dirs));
}

let cached: Record<BinName, string> = { ffmpeg: '', ffprobe: '' };

/**
 * config.paths 中的显式路径（由 configStore 注入，避免与 configStore 循环依赖）
 * 这样 detector / taskRunner / probe 等所有调用点都无需传参即可生效。
 */
const configuredBins: Partial<Record<BinName, string>> = {};

export function setConfiguredBins(paths: { ffmpeg?: string; ffprobe?: string }): void {
  configuredBins.ffmpeg = paths.ffmpeg?.trim() || undefined;
  configuredBins.ffprobe = paths.ffprobe?.trim() || undefined;
  cached = { ffmpeg: '', ffprobe: '' };
}

/**
 * 解析 ffmpeg / ffprobe 绝对路径（C5：随应用分发，不要求用户安装）
 * 优先级：显式参数 → config.paths → 候选目录 → PATH
 */
export function resolveBin(name: BinName, configured?: string): string {
  const explicit = configured || configuredBins[name];
  if (explicit && isFile(explicit)) return explicit;

  const fileName = BIN_NAME(name);
  for (const dir of candidateDirs()) {
    const p = path.join(dir, fileName);
    if (isFile(p)) {
      cached[name] = p;
      return p;
    }
  }
  if (cached[name] && isFile(cached[name])) return cached[name];
  return fileName; // 交给系统 PATH
}

export const ffmpegPath = (configured?: string): string => resolveBin('ffmpeg', configured);
export const ffprobePath = (configured?: string): string => resolveBin('ffprobe', configured);

/**
 * 必需二进制：缺失会导致核心功能不可用
 * - ffmpeg ：转码 / 缩略图 / 编辑 / 拼接
 * - ffprobe：媒体探针（加入队列的前提，缺它任何文件都读不出信息）
 *
 * 注：ffplay 已从发布包中移除（节省 100MB+），仅用于已废弃的外部预览窗口；
 * 现有预览由 ffmpeg 抓帧与应用内 <video> 实现，无需 ffplay。
 */
export const REQUIRED_BINS: readonly BinName[] = ['ffmpeg', 'ffprobe'];

const ALL_BINS: readonly BinName[] = REQUIRED_BINS;

export interface BinStatus {
  /** 解析到的路径（未找到时是裸名，交给系统 PATH） */
  paths: Record<BinName, string>;
  /** 实际不存在的二进制 */
  missing: BinName[];
  /** 缺失且属于必需项（用于启动拦截提示） */
  missingRequired: BinName[];
}

/** 三个二进制的解析状态（供启动自检 / 提示框使用） */
export function binStatus(): BinStatus {
  const paths = {} as Record<BinName, string>;
  const missing: BinName[] = [];
  for (const name of ALL_BINS) {
    const p = resolveBin(name);
    paths[name] = p;
    if (!isFile(p)) missing.push(name);
  }
  return {
    paths,
    missing,
    missingRequired: missing.filter((n) => REQUIRED_BINS.includes(n))
  };
}

const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;
const MH_MAGIC_64 = 0xfeedfacf;

/**
 * 读取 Mach-O 可执行文件的 CPU 类型（非 Mach-O / 读取失败返回 null）
 * 用途：M 系列机器上若用 Intel(x86_64) 版 ffmpeg，Rosetta 转译进程
 * 拿不到 HEVC 硬件编码器（hevc_videotoolbox 报 -12908）。
 */
export function machoCpuType(file: string): 'x86_64' | 'arm64' | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    if (buf.readUInt32LE(0) !== MH_MAGIC_64) return null;
    const cputype = buf.readUInt32LE(4);
    if (cputype === CPU_TYPE_ARM64) return 'arm64';
    if (cputype === CPU_TYPE_X86_64) return 'x86_64';
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 返回针对当前机器的二进制架构告警（无问题返回 null）。
 * M 系列 + Intel 版 ffmpeg = 无法使用 HEVC 硬件编码。
 */
export function binaryArchWarning(bin: string, arch: string = process.arch): string | null {
  if (process.platform !== 'darwin') return null;
  if (arch !== 'arm64') return null;
  if (!isFile(bin)) return null;
  const cpu = machoCpuType(bin);
  if (cpu !== 'x86_64') return null;
  return (
    `当前 ffmpeg 是 Intel(x86_64) 版本（${bin}），在 Apple Silicon 上经 Rosetta 运行，` +
    `无法访问 M 系列的 HEVC 硬件编码器（hevc_videotoolbox 会报 -12908）。` +
    `请改用 arm64 原生构建：brew install ffmpeg，或把 arm64 版放进 ffmpeg/bin/mac/。`
  );
}

/** 同名二进制是否与 ffmpeg 同目录（用于 yt-dlp 等附加工具探测） */
export function resolveTool(name: string): string | null {
  const fileName = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of candidateDirs()) {
    const p = path.join(dir, fileName);
    if (isFile(p)) return p;
  }
  return null;
}

/** 目录下的可写性检测（§5.2 写权限 fallback） */
export function isWritable(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** 路径遍历防护（§17.2） */
export function assertSafePath(baseDir: string, target: string): string {
  const resolved = path.resolve(baseDir, target);
  const base = path.resolve(baseDir);
  if (!resolved.startsWith(base)) {
    throw new Error(`非法路径：${target}`);
  }
  return resolved;
}
