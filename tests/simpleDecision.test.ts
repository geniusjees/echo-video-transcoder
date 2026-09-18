import { describe, expect, it } from 'vitest';
import { decideSimple } from '../src/main/transcoder/simpleDecision';
import type { SourceInfo } from '@shared/types';

function src(p: Partial<SourceInfo>): SourceInfo {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateMbps: 6,
    durationSec: 60,
    codec: 'h264',
    hasAudio: true,
    ...p
  };
}

describe('§7 简单模式决策树（综合判断 B）', () => {
  it('720p 30fps 4Mbps → no-op', () => {
    const d = decideSimple(src({ width: 1280, height: 720, bitrateMbps: 4 }), {
      scaleResolution: false
    });
    expect(d.action).toBe('no-op');
    expect(d.params).toBeNull();
  });

  it('720p 30fps 10Mbps → 转码，保留 720p、按 CRF 28 质量压制（B 综合判断）', () => {
    const d = decideSimple(src({ width: 1280, height: 720, bitrateMbps: 10 }), {
      scaleResolution: false
    });
    expect(d.action).toBe('transcode');
    expect(d.params?.resolution).toBe(720);
    expect(d.params?.crf).toBe(28);
    expect(d.params?.caps.resolution).toBe(false);
  });

  it('1080p 30fps 6Mbps → no-op', () => {
    const d = decideSimple(src({ bitrateMbps: 6 }), { scaleResolution: false });
    expect(d.action).toBe('no-op');
  });

  it('普通模式输出应使用 CRF 28，而不是 VBR 6Mbps', () => {
    const d = decideSimple(src({ bitrateMbps: 10 }), { scaleResolution: false });
    expect(d.action).toBe('transcode');
    expect(d.params?.crf).toBe(28);
  });

  it('1080p 60fps 10Mbps → 按统一配置重编码 1080p/30/CRF 28', () => {
    const d = decideSimple(src({ fps: 60, bitrateMbps: 10 }), { scaleResolution: false });
    expect(d.action).toBe('transcode');
    expect(d.params?.resolution).toBe(1080);
    expect(d.params?.fps).toBe(30);
    expect(d.params?.crf).toBe(28);
  });

  it('4K 30fps 20Mbps + 开关是 → 缩放 1080p/30/CRF 28', () => {
    const d = decideSimple(src({ width: 3840, height: 2160, bitrateMbps: 20 }), {
      scaleResolution: true
    });
    expect(d.params?.resolution).toBe(1080);
    expect(d.params?.fps).toBe(30);
    expect(d.params?.crf).toBe(28);
  });

  it('4K 30fps 20Mbps + 开关否 → 保持 4K，输出按 CRF 28 质量压制', () => {
    const d = decideSimple(src({ width: 3840, height: 2160, bitrateMbps: 20 }), {
      scaleResolution: false
    });
    expect(d.params?.resolution).toBe(2160);
    expect(d.params?.crf).toBe(28);
    expect(d.params?.caps.bitrate).toBe(true);
  });

  it('4K 30fps 30Mbps + 开关否 → 保持 4K，输出仍使用 CRF 28', () => {
    const d = decideSimple(src({ width: 3840, height: 2160, bitrateMbps: 30 }), {
      scaleResolution: false
    });
    expect(d.params?.crf).toBe(28);
    expect(d.params?.caps.bitrate).toBe(false);
  });

  it('4K 24fps 10Mbps + 开关否 → 仍按 CRF 28 输出，并保持 24fps', () => {
    const d = decideSimple(src({ width: 3840, height: 2160, fps: 24, bitrateMbps: 10 }), {
      scaleResolution: false
    });
    expect(d.params?.crf).toBe(28);
    expect(d.params?.fps).toBe(24); // 不插帧
  });

  it('1440p + 开关否 → 仍按 CRF 28 输出，保持 1440p', () => {
    const d = decideSimple(src({ width: 2560, height: 1440, bitrateMbps: 20 }), {
      scaleResolution: false
    });
    expect(d.params?.crf).toBe(28);
    expect(d.params?.resolution).toBe(1440);
  });

  it('未知码率 → 保守转码', () => {
    const d = decideSimple(src({ bitrateMbps: undefined, height: 720, width: 1280 }), {
      scaleResolution: false
    });
    expect(d.action).toBe('transcode');
  });

  it('C6：任何情形输出分辨率不高于源', () => {
    const cases = [
      { width: 1280, height: 720, bitrateMbps: 10 },
      { width: 3840, height: 2160, bitrateMbps: 8 },
      { width: 1920, height: 1080, bitrateMbps: 30 }
    ];
    for (const c of cases) {
      const d = decideSimple(src(c), { scaleResolution: true });
      expect(d.params!.resolution).toBeLessThanOrEqual(c.height);
    }
  });

  it('C6：任何情形输出码率不高于源（源码率已知时）', () => {
    const cases = [
      { width: 3840, height: 2160, bitrateMbps: 12, fps: 30 },
      { width: 2560, height: 1440, bitrateMbps: 5, fps: 30 },
      { width: 1920, height: 1080, bitrateMbps: 3, fps: 25 }
    ];
    for (const c of cases) {
      const d = decideSimple(src(c), { scaleResolution: false });
      if (d.params) {
        expect(d.params.bitrateMbps).toBeLessThanOrEqual(c.bitrateMbps);
      }
    }
  });
});
