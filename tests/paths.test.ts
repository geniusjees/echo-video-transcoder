import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REQUIRED_BINS,
  appRoot,
  binStatus,
  binaryArchWarning,
  configPath,
  ffmpegPath,
  ffprobePath,
  isWritable,
  machoCpuType,
  resolveBin,
  setConfiguredBins
} from '../src/main/utils/paths';

describe('§5 应用根目录与 FFmpeg 路径（C5）', () => {
  afterEach(() => {
    // 清掉测试注入的显式路径，避免互相干扰
    setConfiguredBins({});
  });

  it('开发态根目录 = 进程工作目录', () => {
    expect(appRoot()).toBe(process.cwd());
  });

  it('config.json 位于应用根目录', () => {
    expect(configPath()).toBe(path.join(appRoot(), 'config.json'));
  });

  it('ffmpeg / ffprobe 必须解析到实际存在的文件（不能是同名目录）', () => {
    const ff = ffmpegPath();
    const fp = ffprobePath();
    expect(path.isAbsolute(ff) || ff === 'ffmpeg' || ff === 'ffmpeg.exe').toBe(true);
    if (path.isAbsolute(ff)) {
      expect(fs.existsSync(ff)).toBe(true);
      // 必须是「文件」：仓库根目录存在 ffmpeg/ 目录，曾被误判为可执行文件
      expect(fs.statSync(ff).isFile()).toBe(true);
      expect(fs.existsSync(fp)).toBe(true);
      expect(fs.statSync(fp).isFile()).toBe(true);
    }
  });

  it('同名目录绝不能被当作可执行文件返回', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-dir-'));
    // 造一个名为 ffmpeg 的「目录」，并把它当成显式配置传进去
    const fakeBin = path.join(dir, 'ffmpeg');
    fs.mkdirSync(fakeBin);
    try {
      expect(resolveBin('ffmpeg', fakeBin)).not.toBe(fakeBin);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('config.paths 注入的绝对路径应被所有调用点优先采用', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-bin-'));
    const custom = path.join(dir, 'ffmpeg');
    fs.writeFileSync(custom, '#!/bin/sh\n', { mode: 0o755 });
    try {
      setConfiguredBins({ ffmpeg: custom });
      expect(ffmpegPath()).toBe(custom);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('根目录可写性检测可用', () => {
    expect(typeof isWritable(appRoot())).toBe('boolean');
  });

  it('REQUIRED_BINS 只含 ffmpeg / ffprobe（ffplay 已不随包分发）', () => {
    expect([...REQUIRED_BINS].sort()).toEqual(['ffmpeg', 'ffprobe']);
  });

  it('binStatus 应正确报告必需二进制的缺失情况', () => {
    const status = binStatus();
    expect(Object.keys(status.paths).sort()).toEqual(['ffmpeg', 'ffprobe']);
    // 现在只剩必需项，missing 与 missingRequired 应一致
    expect(status.missingRequired).toEqual(status.missing);
    for (const n of status.missingRequired) {
      expect(REQUIRED_BINS).toContain(n);
    }
    // 必需项缺失必须被拦截（用 isFile 判断，避免同名目录造成误判）
    for (const n of ['ffmpeg', 'ffprobe'] as const) {
      const p = status.paths[n];
      let realFile = false;
      try {
        realFile = fs.statSync(p).isFile();
      } catch {
        realFile = false;
      }
      if (!realFile) expect(status.missingRequired).toContain(n);
    }
  });

  it('能识别 Mach-O 二进制的 CPU 类型，非 Mach-O 安全返回 null', () => {
    const macBin = path.join(appRoot(), 'ffmpeg', 'bin', 'mac', 'ffmpeg');
    // Windows PE 二进制不是 Mach-O
    expect(machoCpuType(path.join(appRoot(), 'ffmpeg', 'bin', 'ffmpeg.exe'))).toBeNull();
    expect(machoCpuType(path.join(appRoot(), 'does-not-exist'))).toBeNull();
    if (process.platform === 'darwin' && fs.existsSync(macBin)) {
      // 仓库自带的是 Intel 版，M 系列上会因此拿不到 HEVC 硬件编码器
      expect(machoCpuType(macBin)).toBe('x86_64');
    }
  });

  it('M 系列 + Intel 版 ffmpeg 应给出架构告警', () => {
    const macBin = path.join(appRoot(), 'ffmpeg', 'bin', 'mac', 'ffmpeg');
    // arm64 机器才会告警；指定 x86_64 时不告警
    expect(binaryArchWarning(macBin, 'x86_64')).toBeNull();
    if (process.platform === 'darwin' && fs.existsSync(macBin)) {
      const warn = binaryArchWarning(macBin, 'arm64');
      expect(warn).toBeTruthy();
      expect(warn).toContain('x86_64');
    }
  });
});
