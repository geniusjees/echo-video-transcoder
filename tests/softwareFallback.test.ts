import { describe, expect, it } from 'vitest';
import { buildTranscodeArgs, resolveVideoEncoder } from '../src/main/transcoder/commandBuilder';
import type { ResolvedParams, SourceInfo } from '@shared/types';

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

const source: SourceInfo = {
  width: 1920,
  height: 1080,
  fps: 30,
  bitrateMbps: 20,
  durationSec: 60,
  codec: 'h264',
  hasAudio: true
};

describe('硬件编码失败 → 软件编码兜底（§9.3）', () => {
  it('resolveVideoEncoder：forceSoftware 时忽略已选的硬件编码器', () => {
    const p = params({ hwCodec: 'hevc_amf' });
    expect(resolveVideoEncoder(p, {})).toBe('hevc_amf');
    expect(resolveVideoEncoder(p, { forceSoftware: true })).toBe('libx265');
  });

  it('built args：forceSoftware 时输出软件编码 + CRF', () => {
    const args = buildTranscodeArgs('in.mp4', 'out.mp4', params({ hwCodec: 'hevc_amf' }), source, {
      forceSoftware: true
    }).join(' ');
    expect(args).toContain('-c:v libx265');
    expect(args).not.toContain('hevc_amf');
    expect(args).toContain('-crf 26');
  });

  it('copy 编码不受 forceSoftware 影响', () => {
    expect(resolveVideoEncoder(params({ codec: 'copy', hwCodec: 'hevc_nvenc' }), { forceSoftware: true })).toBe(
      'copy'
    );
  });
});
