import { describe, expect, it } from 'vitest';
import { decideExpert, pickEncoderName, resolveExpertParams } from '../src/shared/params';
import type { ExpertOptions, HWCapability, SourceInfo } from '../src/shared/types';

function source(overrides: Partial<SourceInfo> = {}): SourceInfo {
  return {
    width: 1280,
    height: 720,
    fps: 30,
    bitrateMbps: 8,
    durationSec: 60,
    codec: 'h264',
    hasAudio: true,
    ...overrides
  };
}

function options(overrides: Partial<ExpertOptions> = {}): ExpertOptions {
  return {
    videoCodec: 'hevc',
    hw: 'auto',
    resolutionMode: 'custom',
    allowUpscale: false,
    fpsMode: 'source',
    bitrateMode: 'crf',
    crf: 28,
    audioCodec: 'aac',
    audioBitrateKbps: 192,
    sampleRate: 48000,
    channels: 2,
    container: 'mp4',
    extraArgs: [],
    ...overrides
  };
}

describe('expert custom resolution upscale toggle', () => {
  it('keeps the source resolution when custom target is larger and upscale is off', () => {
    const params = resolveExpertParams(source(), options({ resolution: 2160, allowUpscale: false }));
    expect(params.resolution).toBe(720);
  });

  it('downscales a 4K source to 1080 when the target is lower', () => {
    const params = resolveExpertParams(source({ width: 3840, height: 2160 }), options({ resolution: 1080, allowUpscale: false }));
    expect(params.resolution).toBe(1080);
  });

  it('marks no-op when expert settings match the source exactly', () => {
    const decision = decideExpert(
      source({ width: 1920, height: 1080, fps: 30, bitrateMbps: 6, codec: 'h264' }),
      options({
        resolutionMode: 'source',
        fpsMode: 'source',
        videoCodec: 'h264',
        audioCodec: 'aac',
        container: 'mp4',
        resolution: 1080,
        allowUpscale: false
      })
    );
    expect(decision.action).toBe('no-op');
    expect(decision.params).toBeNull();
  });

  it('keeps the source fps when custom target is higher and fps increase is off', () => {
    const params = resolveExpertParams(source({ fps: 30 }), options({ fpsMode: 'custom', fps: 60, allowIncreaseFps: false }));
    expect(params.fps).toBe(30);
  });

  it('raises fps to the custom target when fps increase is on', () => {
    const params = resolveExpertParams(source({ fps: 30 }), options({ fpsMode: 'custom', fps: 60, allowIncreaseFps: true }));
    expect(params.fps).toBe(60);
  });

  it('expands to the custom target when upscale is on', () => {
    const params = resolveExpertParams(source(), options({ resolution: 2160, allowUpscale: true }));
    expect(params.resolution).toBe(2160);
  });

  it('prefers Apple MPS VideoToolbox instead of falling back to software on arm64 Macs', () => {
    const cap: HWCapability = {
      nvenc: false,
      qsv: false,
      amf: false,
      videotoolbox: true,
      vaapi: false,
      mps: true,
      recommended: 'videotoolbox-mps',
      platform: 'darwin',
      arch: 'arm64',
      encoders: ['hevc_videotoolbox']
    };

    const chosen = pickEncoderName(cap, 'hevc', 'auto');
    expect(chosen.hw).toBe('videotoolbox-mps');
    expect(chosen.encoder).toBe('hevc_videotoolbox');
    expect(chosen.fellBack).toBe(false);
  });
});
