import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSamePath, tempOutputFor } from '../src/main/transcoder/taskRunner';

describe('覆盖原文件（输出 == 输入）处理', () => {
  it('isSamePath 识别同一文件', () => {
    expect(isSamePath('C:/videos/clip.mp4', 'C:/videos/clip.mp4')).toBe(true);
    expect(isSamePath('C:/videos/clip.mp4', 'C:/videos/clip_out.mp4')).toBe(false);
    expect(isSamePath('', 'C:/videos/clip.mp4')).toBe(false);
  });

  it('临时输出与目标同目录、保留扩展名（ffmpeg 靠扩展名判断封装）', () => {
    const target = 'C:/videos/clip.mp4';
    const tmp = tempOutputFor(target, 'q-1');
    expect(path.resolve(path.dirname(tmp))).toBe(path.resolve(path.dirname(target)));
    expect(path.extname(tmp)).toBe('.mp4');
    expect(tmp).not.toBe(target);
  });

  it('不同扩展名也保持原扩展名', () => {
    expect(path.extname(tempOutputFor('C:/videos/clip.mkv', 'q-2'))).toBe('.mkv');
  });
});
