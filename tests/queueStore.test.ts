import { describe, expect, it } from 'vitest';
import type { QueueItem } from '../src/shared/types';
import { shouldPromptClearQueue } from '../src/renderer/stores/queueStore';

function item(status: QueueItem['status']): QueueItem {
  return {
    id: 'id-1',
    input: 'C:/tmp/test.mp4',
    output: 'C:/tmp/out.mp4',
    outputDir: 'C:/tmp',
    source: {
      width: 1920,
      height: 1080,
      fps: 30,
      bitrateMbps: 6,
      durationSec: 60,
      codec: 'h264',
      hasAudio: true,
      fileSizeBytes: 1000
    },
    status,
    resolved: null,
    decision: { action: 'no-op', params: null },
    scaleResolution: false,
    mode: 'simple'
  };
}

describe('queue batch completion prompt', () => {
  it('returns true when all items are final and at least one is done', () => {
    expect(shouldPromptClearQueue([item('done'), item('done')])).toBe(true);
  });

  it('returns false when queue is still running', () => {
    expect(shouldPromptClearQueue([item('done'), item('running')])).toBe(false);
  });

  it('returns false when there are no completed jobs', () => {
    expect(shouldPromptClearQueue([item('error'), item('cancelled')])).toBe(false);
  });
});
