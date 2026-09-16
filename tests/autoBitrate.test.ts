import { describe, expect, it } from 'vitest';
import { computeAutoBitrate } from '../src/main/transcoder/autoBitrate';
import { capBitrate, capFps, capResolution } from '../src/main/transcoder/capRule';

describe('§7.2 码率自动计算', () => {
  it('4K：6 × 4 = 24Mbps', () => {
    expect(computeAutoBitrate(3840, 2160).rawMbps).toBe(24);
  });

  it('1440p：6 × 1.78 = 10.7Mbps', () => {
    expect(computeAutoBitrate(2560, 1440).rawMbps).toBe(10.7);
  });

  it('2K (2048×1080)：6 × 1.07 = 6.4Mbps', () => {
    expect(computeAutoBitrate(2048, 1080).rawMbps).toBe(6.4);
  });

  it('1080p：6Mbps', () => {
    expect(computeAutoBitrate(1920, 1080).rawMbps).toBe(6);
  });

  it('封顶：源码率低于计算值时取源码率', () => {
    expect(computeAutoBitrate(3840, 2160, 10).bitrateMbps).toBe(10);
    expect(computeAutoBitrate(2560, 1440, 10).bitrateMbps).toBe(10);
    expect(computeAutoBitrate(2048, 1080, 10).bitrateMbps).toBe(6.4);
  });

  it('源码率未知 → 不封顶', () => {
    const r = computeAutoBitrate(3840, 2160, undefined);
    expect(r.bitrateMbps).toBe(24);
    expect(r.cappedBySource).toBe(false);
  });
});

describe('C6 封顶规则', () => {
  it('分辨率：目标高于源时取源', () => {
    expect(capResolution(1080, 720)).toEqual({ value: 720, capped: true });
    expect(capResolution(1080, 2160)).toEqual({ value: 1080, capped: false });
  });

  it('帧率：目标高于源时取源（不插帧）', () => {
    expect(capFps(30, 24)).toEqual({ value: 24, capped: true });
    expect(capFps(30, 60)).toEqual({ value: 30, capped: false });
  });

  it('码率：目标高于源时取源', () => {
    expect(capBitrate(6, 4)).toEqual({ value: 4, capped: true });
    expect(capBitrate(6, 20)).toEqual({ value: 6, capped: false });
    expect(capBitrate(24, undefined)).toEqual({ value: 24, capped: false });
  });
});
