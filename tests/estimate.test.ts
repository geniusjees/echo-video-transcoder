import { describe, expect, it } from 'vitest';
import { estimateOutputSize } from '../src/renderer/utils/estimate';
import type { ResolvedParams, SourceInfo } from '@shared/types';

function src(p: Partial<SourceInfo> = {}): SourceInfo {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateMbps: 20,
    durationSec: 300,
    codec: 'h264',
    hasAudio: true,
    ...p
  };
}

function params(p: Partial<ResolvedParams> = {}): ResolvedParams {
  return {
    resolution: 1080,
    fps: 30,
    bitrateMbps: 0,
    crf: 26,
    codec: 'hevc',
    container: 'mp4',
    audioCodec: 'aac',
    audioBitrateKbps: 192,
    sampleRate: 48000,
    channels: 2,
    capped: false,
    caps: { resolution: false, bitrate: false, fps: false },
    ...p
  };
}

/** MB（十进制）→ 字节 */
const MB = 1_000_000;

describe('输出体积预估（按输出分辨率/编码/CRF/音频/时长）', () => {
  it('1080p H.265 CRF 26 · 5min · 192k ≈ 160MB（不再随源码率膨胀）', () => {
    const est = estimateOutputSize(params(), src({ bitrateMbps: 20 }))!;
    expect(est.bytes / MB).toBeGreaterThan(155);
    expect(est.bytes / MB).toBeLessThan(165);
  });

  it('同为 1080p CRF 26，源 50Mbps 与源 20Mbps 预估一致（源码率不再放大体积）', () => {
    const low = estimateOutputSize(params(), src({ bitrateMbps: 20 }))!;
    const high = estimateOutputSize(params(), src({ bitrateMbps: 50 }))!;
    expect(high.bytes).toBe(low.bytes);
    expect(high.bytes / MB).toBeLessThan(200);
  });

  it('CRF 25 比 CRF 26 略大（每 -1 约 ×2^(1/6)）', () => {
    const c26 = estimateOutputSize(params({ crf: 26 }), src())!;
    const c25 = estimateOutputSize(params({ crf: 25 }), src())!;
    expect(c25.bytes).toBeGreaterThan(c26.bytes);
    expect(c25.bytes / c26.bytes).toBeCloseTo(Math.pow(2, 1 / 6), 1);
  });

  it('H.264 CRF 21（基准）→ 1080p 视频 6Mbps', () => {
    const est = estimateOutputSize(params({ codec: 'h264', crf: 21 }), src())!;
    // (6000 + 192) / 8 * 1000 * 300 * 1.02 ≈ 236.8MB
    expect(est.bytes / MB).toBeCloseTo(236.8, 0);
  });

  it('显式码率模式（6Mbps）→ 与同码率 H.264 CRF21 同量级', () => {
    const est = estimateOutputSize(params({ bitrateMbps: 6, crf: undefined }), src())!;
    expect(est.bytes / MB).toBeCloseTo(236.8, 0);
  });

  it('输出码率被源码率封顶（源仅 2Mbps）', () => {
    const est = estimateOutputSize(params({ crf: 26 }), src({ bitrateMbps: 2 }))!;
    // (2000 + 192) / 8 * 1000 * 300 * 1.02 ≈ 83.8MB
    expect(est.bytes / MB).toBeCloseTo(83.8, 0);
  });

  it('4K 源保持 4K 输出 → 码率 ×4（约 ×4 体积）', () => {
    const p4k = params({ resolution: 2160 });
    const s4k = src({ width: 3840, height: 2160, bitrateMbps: 80 });
    const est4k = estimateOutputSize(p4k, s4k)!;
    const est1080 = estimateOutputSize(params(), src())!;
    // 视频 16000 vs 4000，音频固定 192 → 比值略小于 4（≈3.86）
    expect(est4k.bytes / est1080.bytes).toBeGreaterThan(3.8);
    expect(est4k.bytes / est1080.bytes).toBeLessThan(3.95);
  });

  it('4K 源缩放到 1080p 输出 → 按 1080p 估价（不受源 4K 影响）', () => {
    const s4k = src({ width: 3840, height: 2160, bitrateMbps: 80 });
    const est = estimateOutputSize(params({ resolution: 1080 }), s4k)!;
    const ref = estimateOutputSize(params(), src())!;
    expect(est.bytes).toBe(ref.bytes);
  });

  it('音频 none → 不计音频码率', () => {
    const withAudio = estimateOutputSize(params(), src())!;
    const noAudio = estimateOutputSize(params({ audioCodec: 'none' }), src())!;
    expect(noAudio.bytes).toBeLessThan(withAudio.bytes);
  });

  it('时长非法 → 返回 null', () => {
    expect(estimateOutputSize(params(), src({ durationSec: 0 }))).toBeNull();
  });
});
