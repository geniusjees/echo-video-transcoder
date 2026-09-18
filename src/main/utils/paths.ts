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

const BIN_NAME = (name: 'ffmpeg' | 'ffplay' | 'ffprobe'): string =>
  process.platform === 'win32' ? `${name}.exe` : name;

/** 二进制搜索候选目录（越靠前优先级越高） */
function candidateDirs(): string[] {
  const root = appRoot();
  const dirs = [
    root,
    path.join(root, 'ffmpeg', 'bin'),
    path.join(root, 'ffmpeg'),
    path.join(root, 'resources'),
    path.join(root, 'resources', 'ffmpeg', 'bin')
  ];
  // macOS 打包后 extraResources 位于 Contents/Resources
  if (process.resourcesPath) {
    dirs.push(process.resourcesPath, path.join(process.resourcesPath, 'ffmpeg', 'bin'));
  }
  // 开发态兜底
  const cwd = process.cwd();
  dirs.push(path.join(cwd, 'ffmpeg', 'bin'), path.join(cwd, 'ffmpeg'), cwd);
  return Array.from(new Set(dirs));
}

let cached: Record<'ffmpeg' | 'ffplay' | 'ffprobe', string> = { ffmpeg: '', ffplay: '', ffprobe: '' };

/**
 * 解析 ffmpeg / ffplay / ffprobe 绝对路径（C5：随应用分发，不要求用户安装）
 * 优先级：配置指定 → 候选目录 → PATH
 */
export function resolveBin(name: 'ffmpeg' | 'ffplay' | 'ffprobe', configured?: string): string {
  if (configured && fs.existsSync(configured)) return configured;

  const fileName = BIN_NAME(name);
  for (const dir of candidateDirs()) {
    const p = path.join(dir, fileName);
    if (fs.existsSync(p)) {
      cached[name] = p;
      return p;
    }
  }
  if (cached[name] && fs.existsSync(cached[name])) return cached[name];
  return fileName; // 交给系统 PATH
}

export const ffmpegPath = (configured?: string): string => resolveBin('ffmpeg', configured);
export const ffplayPath = (configured?: string): string => resolveBin('ffplay', configured);
export const ffprobePath = (configured?: string): string => resolveBin('ffprobe', configured);

/** 同名二进制是否与 ffmpeg 同目录（用于 yt-dlp 等附加工具探测） */
export function resolveTool(name: string): string | null {
  const fileName = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of candidateDirs()) {
    const p = path.join(dir, fileName);
    if (fs.existsSync(p)) return p;
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
