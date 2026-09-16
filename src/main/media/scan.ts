import fs from 'node:fs';
import path from 'node:path';

/** 支持的视频扩展名 */
const VIDEO_EXT = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
  '.mpg',
  '.mpeg',
  '.ts',
  '.mts',
  '.m2ts',
  '.3gp',
  '.ogv'
]);

export function isVideoFilePath(p: string): boolean {
  return VIDEO_EXT.has(path.extname(p).toLowerCase());
}

export interface ScanResult {
  files: string[];
  /** 遍历到的子文件夹数量 */
  folders: number;
  /** 是否因数量/深度上限被截断 */
  truncated: boolean;
}

/** 扫描进度回调（已找到视频数 / 已遍历子文件夹数） */
export type ScanProgress = (found: number, folders: number) => void;

/**
 * 递归扫描文件夹下的视频文件（含所有子文件夹）
 * 带深度与数量上限，避免大目录卡死主进程。
 */
export function scanVideoFiles(
  dir: string,
  opts: { maxDepth?: number; maxFiles?: number } = {},
  onProgress?: ScanProgress
): ScanResult {
  const maxDepth = opts.maxDepth ?? 24;
  const maxFiles = opts.maxFiles ?? 5000;
  const files: string[] = [];
  let folders = 0;
  let truncated = false;

  const walk = (current: string, depth: number): void => {
    if (depth > maxDepth || truncated) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      // 跳过隐藏文件/文件夹
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        folders += 1;
        onProgress?.(files.length, folders);
        walk(full, depth + 1);
      } else if (entry.isFile() && isVideoFilePath(full)) {
        files.push(full);
        onProgress?.(files.length, folders);
      }
    }
  };

  walk(dir, 0);
  // 自然排序：clip2 排在 clip10 之前
  files.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));
  return { files, folders, truncated };
}

export interface ExpandResult extends ScanResult {
  /** 展开出的视频文件总数（等于 files.length） */
  expandedFromFolders: number;
}

/**
 * 把「文件 + 文件夹」混合列表展开成视频文件列表
 * 文件夹 → 递归扫描；普通文件 → 原样保留（后续再校验格式）
 */
export function expandPaths(paths: string[], onProgress?: ScanProgress): ExpandResult {
  const out: string[] = [];
  let folders = 0;
  let truncated = false;
  let expandedFromFolders = 0;

  for (const p of paths.filter(Boolean)) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        const res = scanVideoFiles(p, {}, onProgress);
        folders += 1;
        expandedFromFolders += res.files.length;
        truncated = truncated || res.truncated;
        out.push(...res.files);
      } else if (st.isFile()) {
        out.push(p);
      }
    } catch {
      // 不存在/无权限：保留原路径，交给上层给出错误提示
      out.push(p);
    }
  }

  const files = Array.from(new Set(out));
  return { files, folders, truncated, expandedFromFolders };
}
