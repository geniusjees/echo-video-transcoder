import { describe, expect, it } from 'vitest';
import { makeOutputPath } from '@shared/outputPath';

describe('输出路径生成（主/渲染进程共用）', () => {
  it('指定输出目录 → 目录/文件名_out.扩展名', () => {
    expect(makeOutputPath('C:\\videos\\clip.mov', 'D:/out', 'mp4')).toBe('D:/out/clip_out.mp4');
  });

  it('输出目录为空 → 回退到源目录', () => {
    expect(makeOutputPath('C:/videos/clip.mov', '', 'mp4')).toBe('C:/videos/clip_out.mp4');
  });

  it('输出目录末尾斜杠不重复', () => {
    expect(makeOutputPath('C:/videos/clip.mov', 'D:/out/', 'mp4')).toBe('D:/out/clip_out.mp4');
  });

  it('不同任务类型使用不同后缀', () => {
    expect(makeOutputPath('C:/a/clip.mp4', 'D:/out', 'mp4', 'rotate')).toBe('D:/out/clip_rotated.mp4');
    expect(makeOutputPath('C:/a/clip.mp4', 'D:/out', 'mp4', 'edit')).toBe('D:/out/clip_edited.mp4');
    expect(makeOutputPath('C:/a/clip.mp4', 'D:/out', 'mp3', 'extractAudio')).toBe('D:/out/clip.mp3');
  });

  it('改输出目录只影响目录，不影响文件名', () => {
    const a = makeOutputPath('C:/videos/clip.mov', 'D:/one', 'mp4');
    const b = makeOutputPath('C:/videos/clip.mov', 'D:/two', 'mp4');
    expect(a.split('/').pop()).toBe(b.split('/').pop());
    expect(a.startsWith('D:/one/')).toBe(true);
    expect(b.startsWith('D:/two/')).toBe(true);
  });
});
