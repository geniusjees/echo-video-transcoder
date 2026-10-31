import { describe, expect, it } from 'vitest';
import {
  MAX_SUFFIX_LENGTH,
  makeOutputPath,
  outputFileName,
  resolveSuffix,
  validateSuffix
} from '@shared/outputPath';

describe('文件名后缀校验（所有操作系统通用规则）', () => {
  it('合法后缀通过校验', () => {
    expect(validateSuffix('_out').ok).toBe(true);
    expect(validateSuffix('  _out  ').ok).toBe(true);
    expect(validateSuffix('转码-1').ok).toBe(true);
  });

  it('空后缀不合法', () => {
    const r = validateSuffix('   ');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('empty');
  });

  it('超过 16 字符不合法', () => {
    const ok = 'a'.repeat(MAX_SUFFIX_LENGTH);
    const tooLong = 'a'.repeat(MAX_SUFFIX_LENGTH + 1);
    expect(validateSuffix(ok).ok).toBe(true);
    expect(validateSuffix(tooLong).code).toBe('tooLong');
  });

  it('Windows 保留字符不合法', () => {
    for (const ch of ['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
      const r = validateSuffix(`a${ch}b`);
      expect(r.ok, `字符 ${ch} 应被判为非法`).toBe(false);
      expect(r.code).toBe('invalidChar');
      expect(r.chars).toContain(ch);
    }
  });

  it('控制字符不合法', () => {
    const r = validateSuffix('a\u0001b');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('controlChar');
  });

  it('以「.」结尾不合法（Windows 会静默去掉结尾的点）', () => {
    const r = validateSuffix('_out.');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('trailingDot');
  });
});

describe('输出命名规则', () => {
  it('不传选项时保持原有行为（_out）', () => {
    expect(makeOutputPath('C:/videos/clip.mov', 'D:/out', 'mp4')).toBe('D:/out/clip_out.mp4');
    expect(resolveSuffix('transcode')).toBe('_out');
  });

  it('自定义后缀生效', () => {
    expect(
      makeOutputPath('C:/videos/clip.mov', 'D:/out', 'mp4', 'transcode', {
        appendSuffix: true,
        suffix: '_转码'
      })
    ).toBe('D:/out/clip_转码.mp4');
  });

  it('取消后缀 → 文件名与源一致', () => {
    expect(
      makeOutputPath('C:/videos/clip.mov', 'D:/out', 'mp4', 'transcode', {
        appendSuffix: false
      })
    ).toBe('D:/out/clip.mp4');
  });

  it('后缀非法时回退默认后缀（不生成无法创建的文件名）', () => {
    expect(
      makeOutputPath('C:/videos/clip.mov', 'D:/out', 'mp4', 'transcode', {
        appendSuffix: true,
        suffix: 'a/b'
      })
    ).toBe('D:/out/clip_out.mp4');
    expect(
      makeOutputPath('C:/videos/clip.mov', 'D:/out', 'mp4', 'transcode', {
        appendSuffix: true,
        suffix: ''
      })
    ).toBe('D:/out/clip_out.mp4');
  });

  it('与原文件同一文件夹 → 每个文件输出到各自所在目录', () => {
    expect(
      makeOutputPath('C:/videos/a/clip.mov', 'D:/out', 'mp4', 'transcode', {
        sameAsSource: true
      })
    ).toBe('C:/videos/a/clip_out.mp4');
    expect(
      makeOutputPath('E:/other/b/movie.mkv', 'D:/out', 'mp4', 'transcode', {
        sameAsSource: true,
        appendSuffix: false
      })
    ).toBe('E:/other/b/movie.mp4');
  });

  it('同目录 + 无后缀 → 与源文件同名（覆盖原文件）', () => {
    const out = makeOutputPath('C:/videos/clip.mp4', '', 'mp4', 'transcode', {
      sameAsSource: true,
      appendSuffix: false
    });
    expect(out).toBe('C:/videos/clip.mp4');
  });

  it('自定义后缀作用于转码 / 编辑 / 旋转，其它任务类型不受影响', () => {
    for (const kind of ['transcode', 'edit', 'rotate'] as const) {
      expect(
        makeOutputPath('C:/a/clip.mp4', 'D:/out', 'mp4', kind, {
          appendSuffix: true,
          suffix: '_x'
        })
      ).toBe('D:/out/clip_x.mp4');
    }
    // 提取音频 / 拼接不支持自定义后缀
    expect(
      makeOutputPath('C:/a/clip.mp4', 'D:/out', 'mp3', 'extractAudio', {
        appendSuffix: true,
        suffix: '_x'
      })
    ).toBe('D:/out/clip.mp3');
  });

  it('旋转任务：默认 _rotated，可取消后缀并输出到源目录', () => {
    expect(makeOutputPath('C:/a/clip.mp4', 'D:/out', 'mp4', 'rotate')).toBe(
      'D:/out/clip_rotated.mp4'
    );
    expect(
      makeOutputPath('C:/a/clip.mp4', 'D:/out', 'mp4', 'rotate', {
        appendSuffix: false,
        sameAsSource: true
      })
    ).toBe('C:/a/clip.mp4');
  });

  it('编辑任务：默认 _edited，可取消后缀并输出到源目录', () => {
    expect(makeOutputPath('C:/a/clip.mov', 'D:/out', 'mp4', 'edit')).toBe('D:/out/clip_edited.mp4');
    expect(
      makeOutputPath('C:/a/clip.mp4', 'D:/out', 'mp4', 'edit', {
        appendSuffix: false,
        sameAsSource: true
      })
    ).toBe('C:/a/clip.mp4');
    expect(resolveSuffix('edit', { appendSuffix: false })).toBe('');
  });

  it('outputFileName 只返回文件名', () => {
    expect(outputFileName('C:/videos/clip.mov', 'mp4', 'transcode')).toBe('clip_out.mp4');
    expect(
      outputFileName('C:/videos/clip.mov', 'mp4', 'transcode', { appendSuffix: false })
    ).toBe('clip.mp4');
  });
});
