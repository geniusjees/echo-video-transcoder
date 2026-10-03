import { describe, expect, it } from 'vitest';
import {
  buildQualityArgs,
  crfEquivalentBitrateMbps,
  crfToVtQscale,
  encoderKind
} from '../src/main/transcoder/encoderProfile';
import type { QualityEnv } from '../src/main/transcoder/encoderProfile';

describe('encoderKind 按编码器名归类厂商', () => {
  it('识别各厂商与软件编码器', () => {
    expect(encoderKind('hevc_nvenc')).toBe('nvenc');
    expect(encoderKind('h264_qsv')).toBe('qsv');
    expect(encoderKind('hevc_amf')).toBe('amf');
    expect(encoderKind('hevc_vaapi')).toBe('vaapi');
    expect(encoderKind('hevc_videotoolbox')).toBe('videotoolbox');
    expect(encoderKind('libx265')).toBe('software');
    expect(encoderKind('libsvtav1')).toBe('software');
  });
});

describe('§9.3 VideoToolbox -q:v 方向与取值', () => {
  it('q:v 越大画质越好：CRF 越大 → q:v 越小', () => {
    expect(crfToVtQscale(18)).toBeGreaterThan(crfToVtQscale(26));
    expect(crfToVtQscale(33)).toBeLessThan(crfToVtQscale(26));
  });

  it('CRF26（默认目标）锚点为 60，且始终落在 1–100', () => {
    expect(crfToVtQscale(26)).toBe(60);
    expect(crfToVtQscale(0)).toBeLessThanOrEqual(100);
    expect(crfToVtQscale(51)).toBeGreaterThanOrEqual(1);
  });
});

describe('§9.3 各显卡恒定质量参数（CRF26）', () => {
  const env: QualityEnv = { platform: 'win32', vtConstantQuality: false };
  const intent = { crf: 26, bitrateMbps: 0 };
  const args = (kind: Parameters<typeof buildQualityArgs>[0]) =>
    buildQualityArgs(kind, intent, env).join(' ');

  it('NVENC → vbr + cq', () => {
    expect(args('nvenc')).toBe('-rc vbr -cq 26 -b:v 0');
  });
  it('QSV → global_quality', () => {
    expect(args('qsv')).toBe('-global_quality 26');
  });
  it('AMF → cqp + qp_i/qp_p', () => {
    expect(args('amf')).toBe('-rc cqp -qp_i 26 -qp_p 26');
  });
  it('VAAPI → CQP + qp', () => {
    expect(args('vaapi')).toBe('-rc_mode CQP -qp 26');
  });
  it('软件 → crf + preset', () => {
    expect(args('software')).toBe('-crf 26 -preset medium');
  });
});

describe('VideoToolbox 按系统切换恒定质量 / 码率（§9.3）', () => {
  const intent = { crf: 26, bitrateMbps: 4 };

  it('darwin + arm64 ffmpeg → -q:v 恒定质量', () => {
    const env: QualityEnv = { platform: 'darwin', vtConstantQuality: true };
    expect(buildQualityArgs('videotoolbox', intent, env)).toEqual(['-q:v', '60']);
  });

  it('darwin + x86_64 ffmpeg → 退回码率（避免 -q:v 报错导致任务失败）', () => {
    const env: QualityEnv = { platform: 'darwin', vtConstantQuality: false };
    const out = buildQualityArgs('videotoolbox', intent, env);
    expect(out).toContain('-b:v');
    expect(out).not.toContain('-q:v');
  });
});

describe('crfEquivalentBitrateMbps（不支持恒定质量时的码率兜底）', () => {
  it('1080p HEVC CRF26 ≈ 4 Mbps，并按源码率封顶（C6）', () => {
    expect(crfEquivalentBitrateMbps({ codec: 'hevc', width: 1920, height: 1080, crf: 26 })).toBe(4);
    expect(
      crfEquivalentBitrateMbps({
        codec: 'hevc',
        width: 1920,
        height: 1080,
        crf: 26,
        sourceBitrateMbps: 2
      })
    ).toBe(2);
  });

  it('CRF 每降 6 点码率约 ×2', () => {
    const base = crfEquivalentBitrateMbps({ codec: 'hevc', width: 1920, height: 1080, crf: 26 });
    const better = crfEquivalentBitrateMbps({ codec: 'hevc', width: 1920, height: 1080, crf: 20 });
    expect(better).toBeCloseTo(base * 2, 1);
  });
});
