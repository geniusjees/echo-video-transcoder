import { describe, expect, it } from 'vitest';
import { buildArgsForTask } from '../src/main/transcoder/commandBuilder';
import { buildFfplayArgs, buildThumbnailArgs } from '../src/main/media/probe';
import type { TaskPayload } from '@shared/types';

describe('编辑任务命令构建', () => {
  it('应按关键帧对齐的直接剪切方式生成参数', () => {
    const payload: TaskPayload = {
      id: 'edit-1',
      kind: 'edit',
      input: 'in.mp4',
      output: 'out.mp4',
      durationSec: 30,
      edit: {
        trimStartSec: 2,
        trimEndSec: 24,
        cutSegments: [],
        transcode: false
      }
    };

    const args = buildArgsForTask(payload, {
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 30,
      codec: 'h264',
      hasAudio: true
    });

    const joined = args.join(' ');
    expect(joined).toContain('-ss');
    expect(joined).toContain('2');
    expect(joined).toContain('-i in.mp4');
    expect(joined).toContain('-t');
    expect(joined).toContain('22');
    expect(joined).toContain('-c');
    expect(joined).toContain('copy');
    expect(joined).toContain('-avoid_negative_ts');
    expect(joined).toContain('make_zero');
    expect(joined).toContain('+faststart');
    expect(joined).not.toContain('amix');
    expect(joined).not.toContain('bg.mp3');
  });

  it('应在预览抓帧时带上旋转和镜像滤镜', () => {
    const args = buildThumbnailArgs('in.mp4', 3.5, { mode: 90, flip: 'horizontal' });
    const joined = args.join(' ');
    expect(joined).toContain('transpose=1');
    expect(joined).toContain('hflip');
  });

  it('应生成 ffplay 预览参数并带上定位和旋转过滤', () => {
    const args = buildFfplayArgs('in.mp4', 3.5, { mode: 90, flip: 'horizontal' }, '预览');
    const joined = args.join(' ');
    expect(joined).toContain('-ss');
    expect(joined).toContain('3.5');
    expect(joined).toContain('transpose=1');
    expect(joined).toContain('hflip');
    expect(joined).toContain('预览');
    expect(joined).not.toContain('-nodisp');
  });
});
