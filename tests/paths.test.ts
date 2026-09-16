import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appRoot, configPath, ffmpegPath, ffprobePath, isWritable } from '../src/main/utils/paths';

describe('§5 应用根目录与 FFmpeg 路径（C5）', () => {
  it('开发态根目录 = 进程工作目录', () => {
    expect(appRoot()).toBe(process.cwd());
  });

  it('config.json 位于应用根目录', () => {
    expect(configPath()).toBe(path.join(appRoot(), 'config.json'));
  });

  it('ffmpeg / ffprobe 必须解析到实际存在的文件', () => {
    const ff = ffmpegPath();
    const fp = ffprobePath();
    expect(path.isAbsolute(ff) || ff === 'ffmpeg' || ff === 'ffmpeg.exe').toBe(true);
    if (path.isAbsolute(ff)) {
      expect(fs.existsSync(ff)).toBe(true);
      expect(fs.existsSync(fp)).toBe(true);
    }
  });

  it('根目录可写性检测可用', () => {
    expect(typeof isWritable(appRoot())).toBe('boolean');
  });
});
