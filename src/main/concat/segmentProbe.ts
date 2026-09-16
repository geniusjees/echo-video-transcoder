import fs from 'node:fs';
import path from 'node:path';
import type { Segment, SegmentInfo } from '@shared/types';
import { probe, thumbnail } from '../media/probe';

/** 受限并发（§16：拖拽大量文件不卡顿） */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 批量探针：补全片段源信息 */
export async function probeSegments(
  inputs: string[],
  concurrency = 4,
  configuredProbe?: string
): Promise<Segment[]> {
  return mapLimit(inputs, concurrency, async (input) => {
    const source = await probe(input, configuredProbe);
    return {
      id: `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      input,
      source
    } satisfies Segment;
  });
}

/** 片段一致性检测 + 缩略图（concat:preview，§13.4） */
export async function previewSegments(
  segments: Segment[],
  withThumbnail = true
): Promise<SegmentInfo[]> {
  return mapLimit(segments, 4, async (seg) => {
    const thumb =
      withThumbnail && seg.source.durationSec >= 0
        ? await thumbnail(seg.input, Math.min(1, Math.max(0, seg.source.durationSec / 2)))
        : '';
    return {
      id: seg.id,
      input: seg.input,
      name: path.basename(seg.input),
      source: seg.source,
      hasAudio: seg.source.hasAudio,
      thumbnail: thumb || undefined,
      trim: seg.trim
    } satisfies SegmentInfo;
  });
}

export function isVideoFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [
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
  ].includes(ext);
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
