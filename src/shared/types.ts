/**
 * 前后端共享类型定义（§11）
 * 渲染进程与主进程均从此处取类型，保证 IPC 契约一致。
 */

// ---------------- 基础枚举 ----------------

export type VideoCodec = 'hevc' | 'h264' | 'av1' | 'vp9' | 'copy';
export type Container = 'mp4' | 'mkv' | 'mov' | 'webm';
export type AudioCodec = 'aac' | 'mp3' | 'opus' | 'flac' | 'wav' | 'none';
export type HWKind =
  | 'nvenc'
  | 'qsv'
  | 'amf'
  | 'videotoolbox'
  | 'videotoolbox-mps'
  | 'vaapi'
  | 'software';
export type BitrateMode = 'crf' | 'cbr' | 'vbr';
export type ResolutionMode = 'source' | 'custom';
export type FpsMode = 'source' | 'custom';

// ---------------- 源信息 ----------------

export interface SourceInfo {
  width: number;
  height: number;
  fps: number;
  /** ffprobe 可能拿不到 → undefined（不封顶） */
  bitrateMbps?: number;
  durationSec: number;
  codec: string;
  /** v4.1：拼接音频统一需要 */
  hasAudio: boolean;
  sampleRate?: number;
  channels?: number;
  audioCodec?: string;
  fileSizeBytes?: number;
}

// ---------------- 目标 / 生效参数 ----------------

export interface Target {
  /** 长边/高度档位，如 1080 */
  resolution: number;
  fps: number;
  bitrateMbps: number;
  /** 普通模式默认压制质量：CRF 26 */
  crf?: number;
  codec: VideoCodec;
}

export interface ResolvedParams extends Target {
  container: Container;
  audioCodec: AudioCodec;
  audioBitrateKbps: number;
  sampleRate: 44100 | 48000 | 96000;
  channels: number;
  /** 实际选用的硬件编码器 */
  hwCodec?: string;
  /** 是否发生了封顶 */
  capped: boolean;
  caps: { resolution: boolean; bitrate: boolean; fps: boolean };
  /** CRF / 质量模式生效值（bitrateMode=crf 或压缩任务） */
  crf?: number;
}

export interface SimpleDecision {
  action: 'transcode' | 'no-op';
  reason?: string;
  params: ResolvedParams | null;
  autoBitrate?: boolean;
}

// ---------------- 队列 ----------------

export interface QueueItem {
  id: string;
  input: string;
  source: SourceInfo;
  mode: 'simple' | 'expert';
  /** 普通模式的分辨率开关 */
  scaleResolution: boolean;
  resolved: ResolvedParams | null;
  decision: SimpleDecision;
  /** 用户指定的输出文件夹 */
  outputDir: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error' | 'cancelled';
  output?: string;
  error?: string;
}

// ---------------- 视频拼接 (v4 / v4.1) ----------------

export interface Segment {
  id: string;
  input: string;
  /** 含 hasAudio / sampleRate / channels / duration */
  source: SourceInfo;
  /** 可选首尾裁剪 */
  trim?: { startSec: number; endSec: number };
}

export type ConcatStrategy = 'copy' | 'transcode';

export interface ConcatPlan {
  /** MVP: 仅 copy / transcode（不含转场） */
  strategy: ConcatStrategy;
  /** 如 "参数一致→纯拼接" / "分辨率不一致→转码对齐" */
  reason: string;
  /** 转码对齐时使用的统一参数(§7) */
  uniform: ResolvedParams;
  /** v4.1 音频统一规则(A 方案) */
  audio: {
    sampleRate: 48000;
    channels: 2;
    silenceOnMissing: true;
  };
  segments: Segment[];
  /** 需要补静音的片段 id */
  silenceSegments: string[];
  /** 预计总时长（秒） */
  totalDurationSec: number;
  /** 纯拼接预估耗时等级 */
  estimate: 'fast' | 'normal' | 'slow';
}

export interface SegmentInfo {
  id: string;
  input: string;
  name: string;
  source: SourceInfo;
  hasAudio: boolean;
  thumbnail?: string;
  trim?: { startSec: number; endSec: number };
}

// ---------------- 硬件 ----------------

export interface HWCapability {
  nvenc: boolean;
  qsv: boolean;
  amf: boolean;
  videotoolbox: boolean;
  vaapi: boolean;
  mps: boolean;
  recommended: HWKind;
  platform: NodeJS.Platform;
  arch: string;
  /**
   * 本机 ffmpeg 二进制自身的 CPU 架构（Windows/Linux 无意义 → 'unknown'）。
   * macOS 上用于判定 VideoToolbox 能否使用 `-q:v` 恒定质量：仓库自带的
   * x86_64 版 ffmpeg 在 Apple Silicon 上经 Rosetta 运行，`-q:v` 会直接报错。
   */
  ffmpegArch?: 'arm64' | 'x86_64' | 'unknown';
  /**
   * VideoToolbox 是否支持 `-q:v` 恒定质量。
   * 仅当 macOS + arm64（Apple Silicon 原生）版 ffmpeg 时为 true；
   * x86_64 版会报 `-q:v qscale not available`，需退回码率模式。
   */
  vtConstantQuality?: boolean;
  /** `ffmpeg -encoders` 中编译进来的编码器名 */
  encoders: string[];
  /**
   * 经过「真实编码一帧」探测、确认本机可用的硬件编码器名（如 `hevc_nvenc`）。
   * 用于避免「厂商可用但该编码不支持」时仍选中导致编码失败。
   */
  probedEncoders?: string[];
}

// ---------------- 专家模式 / 预设 ----------------

export interface ExpertOptions {
  videoCodec: VideoCodec;
  hw: 'auto' | HWKind | 'software';
  resolutionMode: ResolutionMode;
  /** resolutionMode = custom 时的高度档位 */
  resolution?: number;
  /** resolutionMode = custom 且 target > source 时，是否允许放大 */
  allowUpscale?: boolean;
  fpsMode: FpsMode;
  fps?: number;
  /** fpsMode = custom 且 target > source 时，是否允许提高帧率 */
  allowIncreaseFps?: boolean;
  bitrateMode: BitrateMode;
  crf?: number;
  bitrateMbps?: number;
  audioCodec: AudioCodec;
  audioBitrateKbps: number;
  sampleRate: 44100 | 48000 | 96000;
  channels: number;
  container: Container;
  /** libx264/libx265 preset */
  preset?: string;
  extraArgs: string[];
}

export interface Preset {
  id: string;
  name: string;
  options: ExpertOptions;
  createdAt: string;
}

// ---------------- 任务 ----------------

export type TaskKind = 'transcode' | 'rotate' | 'extractAudio' | 'concat' | 'edit';

export type RotateMode = 0 | 90 | 180 | 270;
export type FlipMode = 'none' | 'horizontal' | 'vertical';

export interface EditCutSegment {
  startSec: number;
  endSec: number;
}

export interface EditOptions {
  trimStartSec?: number;
  trimEndSec?: number;
  cutSegments?: EditCutSegment[];
  rotation?: RotateOptions;
}

export interface RotateOptions {
  mode: RotateMode;
  flip: FlipMode;
  /** 优先元数据旋转（不重编码） */
  metadataOnly: boolean;
}

export interface AudioExtractOptions {
  codec: AudioCodec;
  bitrateKbps: number;
  sampleRate: 44100 | 48000 | 96000;
  channels: number;
  startSec?: number;
  endSec?: number;
}

export interface TaskPayload {
  id: string;
  kind: TaskKind;
  input: string;
  output: string;
  durationSec: number;
  /** 可选时间段裁剪（秒） */
  trim?: { startSec: number; endSec: number };
  params?: ResolvedParams;
  rotate?: RotateOptions;
  audio?: AudioExtractOptions;
  concat?: { segments: Segment[]; plan: ConcatPlan };
  edit?: EditOptions;
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'skipped'
  | 'error'
  | 'cancelled';

/** 导入（文件夹扫描 / 批量探针）进度 */
export interface ImportProgressPayload {
  phase: 'scan' | 'probe';
  /** 已处理数量 */
  done: number;
  /** 总数（0 表示进度不确定） */
  total: number;
  /** scan 阶段：已找到的视频文件数 */
  found?: number;
  /** scan 阶段：已遍历的子文件夹数 */
  folders?: number;
}

export interface ProgressPayload {
  id: string;
  taskId: string;
  percent: number;
  frame: number;
  fps: number;
  speed: number;
  outTimeSec: number;
  etaSec?: number;
  status: TaskStatus;
  message?: string;
}

// ---------------- 配置 ----------------

export interface PathsConfig {
  ffmpeg: string;
  ffprobe: string;
  /** 转码 / 旋转 / 编辑 / 提取音频页的输出目录 */
  outputDir: string;
  /** 拼接页独立的输出目录（不与转码共用） */
  concatOutputDir: string;
}

export interface TranscodeConfig {
  parallelJobs: number;
  preferredHW: 'auto' | HWKind;
  fallbackToSoftware: boolean;
  overwrite: 'ask' | 'always' | 'never';
  /** 转码后是否给文件名追加后缀 */
  appendSuffix: boolean;
  /** 自定义文件名后缀（≤ 16 字符，如 "_out"） */
  suffix: string;
  /** 输出到各自输入文件所在目录（与原文件同一文件夹） */
  outputSameAsSource: boolean;
}

export interface SimpleModeConfig {
  enabled: boolean;
  videoCodec: VideoCodec;
  container: Container;
  target: {
    resolution: number;
    fps: number;
    /** 可选：手动覆盖「不转码」码率阈值（Mbps）；留空则按目标编码自动查表 */
    bitrateMbps?: number;
    /** 可选：手动覆盖编码 CRF；留空则按目标编码自动查表 */
    crf?: number;
  };
  scaleResolution: boolean;
  autoBitrateBaseMbps: number;
}

export interface ExpertDefaultsConfig {
  videoCodec: VideoCodec;
  resolutionMode: ResolutionMode;
  allowUpscale?: boolean;
  allowIncreaseFps?: boolean;
  fpsMode: FpsMode;
  bitrateMode: BitrateMode;
  crf: number;
  audioCodec: AudioCodec;
  audioBitrateKbps: number;
  sampleRate: 44100 | 48000 | 96000;
  channels: number;
  container: Container;
  extraArgs: string[];
}

export interface PresetsConfig {
  custom: Preset[];
}

export interface HardwareConfig {
  autoDetect: boolean;
  allow: HWKind[];
  force: HWKind | null;
}

export interface AdvancedConfig {
  showCommandPreview: boolean;
  /** 转码过程中阻止机器进入休眠 / 睡眠 */
  preventSleep: boolean;
}

/** 编辑页的输出命名设置（与转码页同构，但独立保存，互不影响） */
export interface EditConfig {
  /** 编辑后是否给文件名追加后缀 */
  appendSuffix: boolean;
  /** 自定义文件名后缀（≤ 16 字符，如 "_edited"） */
  suffix: string;
  /** 输出到各自输入文件所在目录（与原文件同一文件夹） */
  outputSameAsSource: boolean;
}

/** 旋转 / 翻转页的输出命名设置（与转码页同构，但独立保存） */
export interface RotateConfig {
  /** 旋转后是否给文件名追加后缀 */
  appendSuffix: boolean;
  /** 自定义文件名后缀（≤ 16 字符，如 "_rotated"） */
  suffix: string;
  /** 输出到各自输入文件所在目录（与原文件同一文件夹） */
  outputSameAsSource: boolean;
}

/** 音频提取页的输出设置：扩展名与源文件不同，因此不需要后缀 */
export interface ExtractAudioConfig {
  /** 提取到各自输入文件所在目录 */
  outputSameAsSource: boolean;
}

export interface AppConfig {
  version: string;
  language: string;
  theme: 'system' | 'light' | 'dark';
  paths: PathsConfig;
  transcode: TranscodeConfig;
  edit: EditConfig;
  rotate: RotateConfig;
  extractAudio: ExtractAudioConfig;
  simpleMode: SimpleModeConfig;
  expertDefaults: ExpertDefaultsConfig;
  presets: PresetsConfig;
  hardware: HardwareConfig;
  advanced: AdvancedConfig;
}
