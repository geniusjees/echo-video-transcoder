/** 拖拽文件路径解析（C9） */

/** 通过 preload 的 webUtils 拿到磁盘绝对路径；带降级兜底 */
export function resolvePathForFile(file: File): string {
  try {
    const p = window.api?.getPathForFile?.(file);
    if (p) return p;
  } catch {
    /* ignore */
  }
  const legacy = (file as unknown as { path?: string }).path;
  return legacy ?? '';
}

export interface DropResolveResult {
  /** 解析成功的绝对路径 */
  paths: string[];
  /** 拖入的文件总数 */
  total: number;
  /** 解析失败的文件名 */
  failed: string[];
}

export function resolveDroppedPaths(dt: DataTransfer | null): DropResolveResult {
  const files = Array.from(dt?.files ?? []);
  const paths: string[] = [];
  const failed: string[] = [];
  for (const f of files) {
    const p = resolvePathForFile(f);
    if (p) paths.push(p);
    else failed.push(f.name || '(未知文件)');
  }
  return { paths, total: files.length, failed };
}

/** 判断拖拽内容是否包含文件（用于区分页面内拖拽排序） */
export function dragHasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

const VIDEO_EXT = [
  'mp4',
  'mov',
  'mkv',
  'avi',
  'wmv',
  'flv',
  'webm',
  'm4v',
  'mpg',
  'mpeg',
  'ts',
  'mts',
  'm2ts',
  '3gp',
  'ogv'
];

export function isProbablyVideo(p: string): boolean {
  const ext = p.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXT.includes(ext);
}
