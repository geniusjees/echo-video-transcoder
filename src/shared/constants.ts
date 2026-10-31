import type {
  AudioCodec,
  AppConfig,
  Container,
  HWKind,
  VideoCodec
} from './types';

/** §7 简单模式统一配置 */
export const TARGET = {
  resolution: 1080,
  fps: 30,
  bitrateMbps: 6,
  crf: 26,
  codec: 'hevc' as VideoCodec
};

/** 1080p 参考像素，用于码率自动计算（§7.2） */
export const REF_PIXELS = 1920 * 1080;

/** 各目标编码的等效质量 CRF（H.265 CRF 26 为基准；与分辨率无关） */
export const TARGET_CRF: Record<VideoCodec, number> = {
  h264: 21,
  hevc: 26,
  vp9: 30,
  av1: 33,
  copy: 0 // copy 不适用
};

/**
 * 各目标编码的「不转码」码率阈值 / 自动码率基准（1080p30 视频流码率，Mbps）。
 * 运行时按源像素比缩放（4K = ×4）。
 */
export const NOOP_RATE_BASE: Record<VideoCodec, number> = {
  h264: 6.0,
  hevc: 4.0,
  vp9: 4.0,
  av1: 2.8,
  copy: Infinity // copy 不重新编码
};

/** 归一化后的源编码类别 */
export type CodecKind = VideoCodec | 'legacy' | 'unknown';

/**
 * 源 codec_name → 归一化编码类别。
 * 'legacy' = 表外旧格式（Xvid/MPEG-4/MPEG-2/VC-1…），'unknown' = 探测不到。
 */
export function normalizeCodec(name?: string): CodecKind {
  switch ((name ?? '').trim().toLowerCase()) {
    case 'h264':
    case 'avc1':
    case 'avc':
      return 'h264';
    case 'hevc':
    case 'h265':
    case 'hvc1':
    case 'hev1':
      return 'hevc';
    case 'vp9':
      return 'vp9';
    case 'av1':
    case 'av01':
      return 'av1';
    case '':
      return 'unknown';
    default:
      return 'legacy';
  }
}

/** 是否为旧格式（legacy / 探测不到）→ 需要兜底转码为现代编码 */
export function isLegacyCodec(name?: string): boolean {
  const kind = normalizeCodec(name);
  return kind === 'legacy' || kind === 'unknown';
}

/** v4.1 音频统一规则（A 方案） */
export const AUDIO_UNIFY = {
  sampleRate: 48000 as const,
  channels: 2 as const,
  silenceOnMissing: true as const
};

/** 硬件编码器映射 */
export const HW_ENCODERS: Record<HWKind, Record<VideoCodec, string | null>> = {
  nvenc: { hevc: 'hevc_nvenc', h264: 'h264_nvenc', av1: 'av1_nvenc', vp9: null, copy: null },
  qsv: { hevc: 'hevc_qsv', h264: 'h264_qsv', av1: 'av1_qsv', vp9: null, copy: null },
  amf: { hevc: 'hevc_amf', h264: 'h264_amf', av1: 'av1_amf', vp9: null, copy: null },
  videotoolbox: {
    hevc: 'hevc_videotoolbox',
    h264: 'h264_videotoolbox',
    av1: null,
    vp9: null,
    copy: null
  },
  'videotoolbox-mps': {
    hevc: 'hevc_videotoolbox',
    h264: 'h264_videotoolbox',
    av1: null,
    vp9: null,
    copy: null
  },
  vaapi: { hevc: 'hevc_vaapi', h264: 'h264_vaapi', av1: 'av1_vaapi', vp9: 'vp9_vaapi', copy: null },
  software: {
    hevc: 'libx265',
    h264: 'libx264',
    av1: 'libsvtav1',
    vp9: 'libvpx-vp9',
    copy: null
  }
};

/** 硬件编码不支持时的软件兜底 */
export const SW_FALLBACK: Record<VideoCodec, string> = {
  hevc: 'libx265',
  h264: 'libx264',
  av1: 'libsvtav1',
  vp9: 'libvpx-vp9',
  copy: 'copy'
};

/** 音频编码器映射 */
export const AUDIO_ENCODERS: Record<AudioCodec, string | null> = {
  aac: 'aac',
  mp3: 'libmp3lame',
  opus: 'libopus',
  flac: 'flac',
  wav: 'pcm_s16le',
  none: null
};

/** 容器 ↔ 默认扩展名 */
export const CONTAINER_EXT: Record<Container, string> = {
  mp4: 'mp4',
  mkv: 'mkv',
  mov: 'mov',
  webm: 'webm'
};

/** 音频容器扩展名 */
export const AUDIO_EXT: Record<AudioCodec, string> = {
  aac: 'm4a',
  mp3: 'mp3',
  opus: 'opus',
  flac: 'flac',
  wav: 'wav',
  none: 'm4a'
};

/** 常见视频扩展名（拖拽过滤用，§13.1） */
export const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
  '.wmv',
  '.flv',
  '.webm',
  '.m4v',
  '.mpg',
  '.mpeg',
  '.ts',
  '.mts',
  '.m2ts',
  '.3gp',
  '.ogv'
];

/** IPC 通道（§12） */
export const IPC = {
  CONFIG_GET: 'config:get',
  CONFIG_SAVE: 'config:save',
  PRESET_SAVE: 'preset:save',
  PRESET_DELETE: 'preset:delete',
  PRESET_IMPORT: 'preset:import',
  PRESET_EXPORT: 'preset:export',
  HARDWARE_DETECT: 'hardware:detect',
  MEDIA_PROBE: 'media:probe',
  QUEUE_ADD: 'queue:add',
  SIMPLE_DECIDE: 'simple:decide',
  PARAMS_RESOLVE: 'params:resolve',
  CONCAT_PLAN: 'concat:plan',
  CONCAT_PREVIEW: 'concat:preview',
  TASK_START: 'task:start',
  TASK_CANCEL: 'task:cancel',
  TASK_PAUSE: 'task:pause',
  TASK_RESUME: 'task:resume',
  SELECT_OUTPUT_DIR: 'select:outputDir',
  SELECT_FILES: 'select:files',
  SELECT_FOLDER: 'select:folder',
  FILES_EXPAND: 'files:expand',
  OPEN_PATH: 'open:path',
  OPEN_EXTERNAL: 'open:external',
  THUMBNAIL: 'media:thumbnail',
  BUILD_COMMAND: 'command:build',
  POWER_SET: 'power:set',
  THEME_SET: 'theme:set',
  CLIPBOARD_WRITE: 'clipboard:write',
  /** 事件（M→R） */
  EVT_PROGRESS: 'progress',
  EVT_LOG: 'log',
  EVT_TASK_STATUS: 'task:status',
  EVT_POWER_STATE: 'power:state',
  EVT_CONFIG_CHANGED: 'config:changed',
  EVT_IMPORT_PROGRESS: 'import:progress'
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** 默认配置（§6.1） */
export const DEFAULT_CONFIG: AppConfig = {
  version: '1.0',
  /** 'auto' = 跟随系统语言（匹配不到则英语） */
  language: 'auto',
  /** 'system' = 默认跟随系统主题 */
  theme: 'system',

  paths: {
    ffmpeg: '',
    ffprobe: '',
    outputDir: '',
    concatOutputDir: ''
  },

  transcode: {
    parallelJobs: 1,
    preferredHW: 'auto',
    fallbackToSoftware: true,
    overwrite: 'ask',
    appendSuffix: true,
    suffix: '_out',
    outputSameAsSource: false
  },

  edit: {
    appendSuffix: true,
    suffix: '_edited',
    outputSameAsSource: false
  },

  rotate: {
    appendSuffix: true,
    suffix: '_rotated',
    outputSameAsSource: false
  },

  extractAudio: {
    outputSameAsSource: false
  },

  simpleMode: {
    enabled: true,
    videoCodec: 'hevc',
    container: 'mp4',
    target: {
      resolution: 1080,
      fps: 30
    },
    scaleResolution: false,
    autoBitrateBaseMbps: 6
  },

  expertDefaults: {
    videoCodec: 'hevc',
    resolutionMode: 'source',
    allowUpscale: false,
    allowIncreaseFps: false,
    fpsMode: 'source',
    bitrateMode: 'crf',
    crf: 26,
    audioCodec: 'aac',
    audioBitrateKbps: 192,
    sampleRate: 48000,
    channels: 2,
    container: 'mp4',
    extraArgs: []
  },

  presets: {
    custom: []
  },

  hardware: {
    autoDetect: true,
    allow: ['nvenc', 'qsv', 'videotoolbox', 'videotoolbox-mps', 'amf', 'vaapi'],
    force: null
  },

  advanced: { showCommandPreview: true, preventSleep: true }
};
