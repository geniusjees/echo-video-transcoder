import { describe, expect, it } from 'vitest';
import { buildTranscodeArgs } from '../src/main/transcoder/commandBuilder';
import type { ResolvedParams, SourceInfo } from '@shared/types';

function src(p: Partial<SourceInfo> = {}): SourceInfo {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateMbps: 20,
    durationSec: 60,
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

function build(p: Partial<ResolvedParams>, s: SourceInfo = src()): string {
  return buildTranscodeArgs('in.mp4', 'out.mp4', params(p), s).join(' ');
}

describe('§9.3 按硬件编码器生成质量参数', () => {
  it('软件编码器（libx265）CRF 模式 → -crf + -preset', () => {
    const a = build({ hwCodec: undefined });
    expect(a).toContain('-c:v libx265');
    expect(a).toContain('-crf 26');
    expect(a).toContain('-preset medium');
  });

  it('NVENC CRF 模式 → -rc vbr -cq 26 -b:v 0（不再依赖 -crf）', () => {
    const a = build({ hwCodec: 'hevc_nvenc' });
    expect(a).toContain('-c:v hevc_nvenc');
    expect(a).toContain('-rc vbr');
    expect(a).toContain('-cq 26');
    expect(a).toContain('-b:v 0');
    expect(a).not.toContain('-crf');
  });

  it('QSV CRF 模式 → -global_quality 26', () => {
    const a = build({ hwCodec: 'hevc_qsv' });
    expect(a).toContain('-c:v hevc_qsv');
    expect(a).toContain('-global_quality 26');
    expect(a).not.toContain('-crf');
  });

  it('AMF CRF 模式 → -rc cqp -qp_i/-qp_p 26', () => {
    const a = build({ hwCodec: 'hevc_amf' });
    expect(a).toContain('-c:v hevc_amf');
    expect(a).toContain('-rc cqp');
    expect(a).toContain('-qp_i 26');
    expect(a).toContain('-qp_p 26');
    expect(a).not.toContain('-crf');
  });

  it('VAAPI CRF 模式 → -rc_mode CQP -qp 26', () => {
    const a = build({ hwCodec: 'hevc_vaapi' });
    expect(a).toContain('-c:v hevc_vaapi');
    expect(a).toContain('-rc_mode CQP');
    expect(a).toContain('-qp 26');
    expect(a).not.toContain('-crf');
  });

  it('VideoToolbox CRF 模式 → -q:v 换算值（越大越好）', () => {
    const a = build({ hwCodec: 'hevc_videotoolbox' });
    expect(a).toContain('-c:v hevc_videotoolbox');
    expect(a).toContain('-q:v 58'); // CRF 26 → 100 - 26*1.6 = 58
    expect(a).not.toContain('-crf');
  });

  it('专家模式码率模式（NVENC）→ -rc vbr + 目标码率', () => {
    const a = build({ hwCodec: 'hevc_nvenc', crf: undefined, bitrateMbps: 6 });
    expect(a).toContain('-rc vbr');
    expect(a).toContain('-b:v 6M');
    expect(a).toContain('-maxrate 6M');
    expect(a).toContain('-bufsize 12M');
    expect(a).not.toContain('-crf');
  });

  it('专家模式码率模式（AMF）→ -rc vbr_peak + 目标码率', () => {
    const a = build({ hwCodec: 'h264_amf', crf: undefined, bitrateMbps: 8 });
    expect(a).toContain('-rc vbr_peak');
    expect(a).toContain('-b:v 8M');
  });

  it('2560x1440 源 → h264_nvenc CRF 21', () => {
    const a = build({ hwCodec: 'h264_nvenc', codec: 'h264', crf: 21 }, src({ width: 2560, height: 1440 }));
    expect(a).toContain('-c:v h264_nvenc');
    expect(a).toContain('-cq 21');
  });
});
