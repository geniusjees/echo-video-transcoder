import { beforeEach, describe, expect, it } from 'vitest';
import type { QueueItem, ResolvedParams } from '@shared/types';
import { useQueueStore } from '../src/renderer/stores/queueStore';

const resolved: ResolvedParams = {
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
  caps: { resolution: false, bitrate: false, fps: false }
};

function item(): QueueItem {
  return {
    id: 'q-1',
    input: 'C:/videos/clip.mp4',
    output: 'C:/old/clip_out.mp4',
    outputDir: 'C:/old',
    source: {
      width: 1920,
      height: 1080,
      fps: 30,
      bitrateMbps: 20,
      durationSec: 60,
      codec: 'h264',
      hasAudio: true,
      fileSizeBytes: 1000
    },
    status: 'pending',
    resolved,
    decision: { action: 'transcode', params: resolved },
    scaleResolution: false,
    mode: 'simple'
  };
}

describe('改输出目录后已入队条目同步（转码页 bug）', () => {
  beforeEach(() => {
    useQueueStore.setState({ items: [item()] });
  });

  it('setOutputDirForAll 更新 outputDir 与 output 路径', () => {
    useQueueStore.getState().setOutputDirForAll('D:/new');
    const it0 = useQueueStore.getState().items[0];
    expect(it0.outputDir).toBe('D:/new');
    expect(it0.output).toBe('D:/new/clip_out.mp4');
  });

  it('幂等：目录未变化时不产生新对象', () => {
    const before = useQueueStore.getState().items;
    useQueueStore.getState().setOutputDirForAll('C:/old');
    expect(useQueueStore.getState().items).toBe(before);
  });

  it('命名规则：与原文件同目录 + 自定义后缀', () => {
    useQueueStore
      .getState()
      .setOutputDirForAll('D:/new', { sameAsSource: true, appendSuffix: true, suffix: '_v2' });
    expect(useQueueStore.getState().items[0].output).toBe('C:/videos/clip_v2.mp4');
  });

  it('命名规则：无后缀 → 与源文件同名（覆盖原文件）', () => {
    useQueueStore
      .getState()
      .setOutputDirForAll('D:/new', { sameAsSource: true, appendSuffix: false });
    expect(useQueueStore.getState().items[0].output).toBe('C:/videos/clip.mp4');
  });
});
