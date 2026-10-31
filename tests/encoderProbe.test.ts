import { describe, expect, it } from 'vitest';
import { buildProbeArgs } from '../src/main/hardware/detector';
import { isHwUsableForCodec, pickEncoderName } from '@shared/params';
import type { HWCapability } from '@shared/types';

describe('硬件编码器真实探测参数', () => {
  it('非 VAAPI：编码 1 帧黑画面到 null，输入 nv12', () => {
    const a = buildProbeArgs('hevc_nvenc');
    const s = a.join(' ');
    expect(s).toContain('-f lavfi');
    // 探测帧必须大于硬件编码器最小尺寸（NVENC 对 128×128 会报 -22）
    expect(s).toContain('color=c=black:s=640x480:r=1');
    expect(a).toContain('-frames:v');
    expect(a).toContain('-pix_fmt');
    expect(a).toContain('nv12');
    expect(a).toContain('-c:v');
    expect(a).toContain('hevc_nvenc');
    expect(s).toContain('-f null -');
    expect(a).not.toContain('-vaapi_device');
  });

  it('VAAPI：带 -vaapi_device 与 hwupload 滤镜', () => {
    const a = buildProbeArgs('hevc_vaapi');
    const s = a.join(' ');
    expect(a).toContain('-vaapi_device');
    expect(s).toContain('format=nv12,hwupload');
    expect(a).toContain('hevc_vaapi');
  });
});

function cap(over: Partial<HWCapability> = {}): HWCapability {
  return {
    nvenc: true,
    qsv: false,
    amf: false,
    videotoolbox: false,
    vaapi: false,
    mps: false,
    recommended: 'nvenc',
    platform: 'win32',
    arch: 'x64',
    encoders: [],
    ...over
  };
}

describe('按真实探测结果选择编码器（probedEncoders）', () => {
  it('探测确认 hevc_nvenc 可用 → 使用硬件编码', () => {
    const r = pickEncoderName(cap({ probedEncoders: ['hevc_nvenc'] }), 'hevc', 'nvenc');
    expect(r.encoder).toBe('hevc_nvenc');
    expect(r.fellBack).toBe(false);
  });

  it('厂商可用但该编码未通过探测（老卡不支持 HEVC）→ 回退软件', () => {
    const r = pickEncoderName(cap({ probedEncoders: ['h264_nvenc'] }), 'hevc', 'nvenc');
    expect(r.encoder).toBe('libx265');
    expect(r.hw).toBe('software');
    expect(r.fellBack).toBe(true);
  });

  it('未做真实探测（无 probedEncoders）→ 保持原有行为', () => {
    const r = pickEncoderName(cap(), 'hevc', 'nvenc');
    expect(r.encoder).toBe('hevc_nvenc');
  });
});

describe('isHwUsableForCodec（按所选编码判断厂商是否可用）', () => {
  it('AMF 支持 HEVC 但不支持 AV1 → AV1 时禁用（避免选了 AMF 却跑软件）', () => {
    const c = cap({ amf: true, probedEncoders: ['hevc_amf', 'h264_amf'] });
    expect(isHwUsableForCodec(c, 'amf', 'hevc')).toBe(true);
    expect(isHwUsableForCodec(c, 'amf', 'av1')).toBe(false);
  });

  it('VideoToolbox 不支持 AV1 / VP9', () => {
    const c = cap({ videotoolbox: true, probedEncoders: ['hevc_videotoolbox'] });
    expect(isHwUsableForCodec(c, 'videotoolbox', 'hevc')).toBe(true);
    expect(isHwUsableForCodec(c, 'videotoolbox', 'av1')).toBe(false);
    expect(isHwUsableForCodec(c, 'videotoolbox', 'vp9')).toBe(false);
  });

  it('厂商不存在 / copy 编码 / 未侦测 → 不可用', () => {
    expect(isHwUsableForCodec(cap({ amf: false }), 'amf', 'hevc')).toBe(false);
    expect(isHwUsableForCodec(cap({ probedEncoders: ['hevc_nvenc'] }), 'nvenc', 'copy')).toBe(false);
    expect(isHwUsableForCodec(null, 'nvenc', 'hevc')).toBe(false);
  });
});
