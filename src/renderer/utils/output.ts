import type { TaskKind } from '@shared/types';

const SUFFIX: Record<TaskKind, string> = {
  transcode: '',
  rotate: '_rotated',
  extractAudio: '',
  concat: ''
};

/** 跨平台路径处理（渲染进程不直接依赖 node:path） */
function splitPath(p: string): { dir: string; base: string; ext: string } {
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  const dir = idx >= 0 ? normalized.slice(0, idx) : '';
  const file = idx >= 0 ? normalized.slice(idx + 1) : normalized;
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot + 1) : '';
  return { dir, base, ext };
}

function join(dir: string, file: string): string {
  if (!dir) return file;
  return `${dir.replace(/\/$/, '')}/${file}`;
}

/** 生成输出路径：用户指定输出文件夹优先，否则与源同目录（§6.2） */
export function makeOutputPath(
  input: string,
  outputDir: string,
  ext: string,
  kind: TaskKind = 'transcode'
): string {
  const { dir, base } = splitPath(input);
  const targetDir = outputDir || dir;
  return join(targetDir, `${base}${SUFFIX[kind]}.${ext}`);
}

export function baseName(p: string): string {
  return splitPath(p).base;
}
