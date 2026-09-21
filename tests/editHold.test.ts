import { describe, expect, it, vi } from 'vitest';
import { buildEditArgs } from '../src/main/transcoder/commandBuilder';
import { createHoldController } from '../src/renderer/utils/editHold';

describe('createHoldController', () => {
  it('repeats step calls while the button is held', () => {
    vi.useFakeTimers();

    const calls: number[] = [];
    const hold = createHoldController({
      intervalMs: 50,
      onStep: (direction) => calls.push(direction)
    });

    hold.start(1);
    vi.advanceTimersByTime(120);
    hold.stop();

    expect(calls).toEqual([1, 1, 1]);
    vi.useRealTimers();
  });
});

describe('edit command builder', () => {
  it('keeps a selected middle segment with a correct duration window', () => {
    const args = buildEditArgs(
      'input.mp4',
      'output.mp4',
      {
        trimStartSec: 3,
        trimEndSec: 5,
        cutSegments: [],
      },
      { durationSec: 10, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true }
    );

    const inputIndex = args.indexOf('-i');
    const ssIndex = args.indexOf('-ss');
    const tIndex = args.indexOf('-t');

    expect(inputIndex).toBeGreaterThan(-1);
    expect(ssIndex).toBeLessThan(inputIndex);
    expect(tIndex).toBeGreaterThan(inputIndex);
    expect(args[ssIndex + 1]).toBe('3');
    expect(args[tIndex + 1]).toBe('2');
    expect(args).not.toContain('-to');
    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args).toContain('-avoid_negative_ts');
    expect(args).toContain('make_zero');
    expect(args.join(' ')).not.toContain("select='not(");
  });
});
