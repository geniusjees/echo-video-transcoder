import type { TaskKind } from './types';

/**
 * 输出路径生成（主进程与渲染进程共用，§6.2 / C7）
 * 必须保持单一实现：入队、命令预览、开始任务三处若各算各的，
 * 会出现「预览的路径 ≠ 实际写出的路径」以及改名/换目录不一致的问题。
 */

/** 各任务类型的输出文件名后缀（与源同目录时避免覆盖源文件） */
const SUFFIX: Record<TaskKind, string> = {
  transcode: '_out',
  rotate: '_rotated',
  extractAudio: '',
  concat: '',
  edit: '_edited'
};

/** 用户自定义后缀的最大长度 */
export const MAX_SUFFIX_LENGTH = 16;

/**
 * 文件名保留字符：按最严格的 Windows 规则校验，
 * 这样生成的文件名在 Windows / macOS / Linux 上都能正常创建。
 */
const RESERVED_CHARS = /[<>:"/\\|?*]/;

/** 后缀校验失败的原因 */
export type SuffixErrorCode = 'empty' | 'tooLong' | 'invalidChar' | 'controlChar' | 'trailingDot';

export interface SuffixValidation {
  ok: boolean;
  code?: SuffixErrorCode;
  /** 命中的非法字符（去重后，用于提示） */
  chars?: string[];
}

/**
 * 校验自定义后缀是否可作为文件名的一部分（所有操作系统通用规则）：
 * - 非空、长度 ≤ 16
 * - 不含 Windows 保留字符 `< > : " / \ | ? *` 与控制字符
 * - 不能以 `.` 结尾（Windows 会静默去掉结尾的点）
 */
export function validateSuffix(raw: string): SuffixValidation {
  const s = (raw ?? '').trim();
  if (!s) return { ok: false, code: 'empty' };

  const chars = Array.from(s);
  if (chars.length > MAX_SUFFIX_LENGTH) return { ok: false, code: 'tooLong' };

  const control = chars.filter((c) => {
    const code = c.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (control.length) return { ok: false, code: 'controlChar', chars: [...new Set(control)] };

  const reserved = chars.filter((c) => RESERVED_CHARS.test(c));
  if (reserved.length) return { ok: false, code: 'invalidChar', chars: [...new Set(reserved)] };

  if (s.endsWith('.')) return { ok: false, code: 'trailingDot' };

  return { ok: true };
}

/** 输出命名选项（转码页的「自定义后缀 / 与原文件同目录」） */
export interface OutputNamingOptions {
  /** 是否追加后缀（仅转码任务生效；不传 = 用任务类型默认后缀） */
  appendSuffix?: boolean;
  /** 自定义后缀文本（trim 后使用；非法时回退默认后缀） */
  suffix?: string;
  /** 输出到各自输入文件所在目录（忽略 outputDir） */
  sameAsSource?: boolean;
}

/** 支持自定义后缀的任务类型（转码 / 编辑 / 旋转页） */
const CUSTOM_SUFFIX_KINDS: TaskKind[] = ['transcode', 'edit', 'rotate'];

/**
 * 解析最终使用的文件名后缀：
 * - 未传 appendSuffix → 保持任务类型默认后缀（向后兼容）
 * - 自定义后缀只作用于转码 / 编辑任务
 * - 后缀非法 → 回退默认后缀，避免生成无法创建的文件名
 */
export function resolveSuffix(kind: TaskKind, opts?: OutputNamingOptions): string {
  const fallback = SUFFIX[kind];
  if (!opts || opts.appendSuffix === undefined) return fallback;
  if (!CUSTOM_SUFFIX_KINDS.includes(kind)) return fallback;
  if (!opts.appendSuffix) return '';
  const custom = (opts.suffix ?? '').trim();
  if (!custom) return fallback;
  return validateSuffix(custom).ok ? custom : fallback;
}

/** 跨平台路径拆分（不依赖 node:path，渲染进程可用） */
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

/** 生成输出文件名（不含目录） */
export function outputFileName(
  input: string,
  ext: string,
  kind: TaskKind = 'transcode',
  opts?: OutputNamingOptions
): string {
  const { base } = splitPath(input);
  return `${base}${resolveSuffix(kind, opts)}.${ext}`;
}

/**
 * 生成输出路径：
 * - `sameAsSource` → 输出到该文件自身所在目录（忽略 outputDir）
 * - 否则用户指定输出文件夹优先，为空则回退到源目录（§6.2）
 */
export function makeOutputPath(
  input: string,
  outputDir: string,
  ext: string,
  kind: TaskKind = 'transcode',
  opts?: OutputNamingOptions
): string {
  const { dir } = splitPath(input);
  const targetDir = opts?.sameAsSource ? dir : outputDir || dir;
  return join(targetDir, outputFileName(input, ext, kind, opts));
}

/** 取文件名（不含扩展名） */
export function baseName(p: string): string {
  return splitPath(p).base;
}
