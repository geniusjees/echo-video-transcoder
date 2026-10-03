import { describe, expect, it } from 'vitest';
import { decideSimple } from '../src/main/transcoder/simpleDecision';
import type { SourceInfo } from '@shared/types';

function src(p: Partial<SourceInfo>): SourceInfo {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateMbps: 4,
    durationSec: 60,
    codec: 'hevc',
    hasAudio: true,
    ...p
  };
}

/**
 * 新逻辑（方案 1）：
 * - 阈值 = NOOP_RATE_BASE[目标编码] × (源像素 / 1080p 像素)
 *   hevc 4.0 / h264 6.0 / vp9 4.0 / av1 2.8（1080p 基准）
 * - CRF = TARGET_CRF[目标编码]（hevc 26 / h264 21 / vp9 30 / av1 33）
 * - 仅按分辨率/码率/帧率判定；现代编码之间不强制互转，旧格式(legacy)兜底转码
 */
describe('§7 简单模式决策树（综合判断 B · 按编码查表）', () => {
  it('1080p 30fps 4Mbps（hevc）→ no-op', () => {
    const d = decideSimple(src({ bitrateMbps: 4 }), { scaleResolution: false });
    expect(d.action).toBe('no-op');
    expect(d.params).toBeNull();
  });

  it('720p 30fps 1.5Mbps（hevc）→ 低规格源 no-op（阈值 4.0×0.44≈1.8）', () => {
    const d = decideSimple(src({ width: 1280, height: 720, bitrateMbps: 1.5 }), {
      scaleResolution: false
    });
    expect(d.action).toBe('no-op');
  });

  it('720p 30fps 4Mbps（hevc）→ 转码，保留 720p、按 CRF 26 压制', () => {
    const d = decideSimple(src({ width: 1280, height: 720, bitrateMbps: 4 }), {
      scaleResolution: false
    });
    expect(d.action).toBe('transcode');
    expect(d.params?.resolution).toBe(720);
    expect(d.params?.crf).toBe(26);
    expect(d.params?.caps.resolution).toBe(false);
  });

  it('1080p 30fps 6Mbps（hevc）→ 转码（hevc 阈值 4.0），CRF 26', () => {
    const d = decideSimple(src({ bitrateMbps: 6 }), { scaleResolution: false });
    expect(d.action).toBe('transcode');
    expect(d.params?.crf).toBe(26);
  });

  it('1080p 60fps 10Mbps → 按统一配置重编码 1080p/30/CRF 26', () => {
    const d = decideSimple(src({ fps: 60, bitrateMbps: 10 }), { scaleResolution: false });
    expect(d.action).toBe('transcode');
    expect(d.params?.resolution).toBe(1080);
    expect(d.params?.fps).toBe(30);
    expect(d.params?.crf).toBe(26);
  });

  it('4K 30fps 20Mbps + 开关是 → 缩放 1080p/30/CRF 26', () => {
    const d = decideSimple(src({ width: 3840, height: 2160, bitrateMbps: 20 }), {
      scaleResolution: true
    });
    expect(d.params?.resolution).toBe(1080);
    expect(d.params?.fps).toBe(30);
    expect(d.params?.crf).toBe(26);
  });

  it('4K 30fps 20Mbps + 开关否 → 保持 4K，自动基准 4.0×4=16（20>16 不封顶）', () => {
    const d = decideSimple(src({ width: 3840, height: 2160, bitrateMbps: 20 }), {
      scaleResolution: false
    });
    expect(d.params?.resolution).toBe(2160);
    expect(d.params?.crf).toBe(26);
    expect(d.params?.caps.bitrate).toBe(false);
  });

  it('4K 30fps 10Mbps + 开关否 → 保持 4K，自动基准 16 被源码率封顶', () => {
    const d = decideSimple(src({ width: 3840, height: 2160, fps: 24, bitrateMbps: 10 }), {
      scaleResolution: false
    });
    expect(d.params?.crf).toBe(26);
    expect(d.params?.fps).toBe(24); // 不插帧
    expect(d.params?.caps.bitrate).toBe(true);
  });

  it('1440p 20Mbps + 开关否 → 保持 1440p、CRF 26', () => {
    const d = decideSimple(src({ width: 2560, height: 1440, bitrateMbps: 20 }), {
      scaleResolution: false
    });
    expect(d.params?.crf).toBe(26);
    expect(d.params?.resolution).toBe(1440);
  });

  it('编码不一致但均为现代格式（源 h264、目标 hevc）→ no-op（不因编码强制转码）', () => {
    const d = decideSimple(src({ codec: 'h264', bitrateMbps: 4 }), { scaleResolution: false });
    expect(d.action).toBe('no-op');
  });

  it('legacy 源（mpeg4/Xvid）规格达标 → 兜底转码为现代编码', () => {
    const d = decideSimple(src({ codec: 'mpeg4', bitrateMbps: 3 }), { scaleResolution: false });
    expect(d.action).toBe('transcode');
    expect(d.params?.codec).toBe('hevc');
  });

  it('探测不到编码（空字符串）→ 兜底转码', () => {
    const d = decideSimple(src({ codec: '', bitrateMbps: 3 }), { scaleResolution: false });
    expect(d.action).toBe('transcode');
  });

  it('目标为 h264 时阈值 6.0：5Mbps no-op、7Mbps 转码（CRF 21）', () => {
    const noop = decideSimple(src({ codec: 'h264', bitrateMbps: 5 }), {
      scaleResolution: false,
      codec: 'h264'
    });
    expect(noop.action).toBe('no-op');

    const trans = decideSimple(src({ codec: 'h264', bitrateMbps: 7 }), {
      scaleResolution: false,
      codec: 'h264'
    });
    expect(trans.action).toBe('transcode');
    expect(trans.params?.crf).toBe(21);
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
