import { describe, expect, it } from 'vitest';
import { buildArgsForTask } from '../src/main/transcoder/commandBuilder';
import { buildFfplayArgs, buildThumbnailArgs } from '../src/main/media/probe';
import type { TaskPayload } from '@shared/types';

describe('编辑任务命令构建', () => {
  it('应生成 trim / cut / bg mix 相关参数', () => {
    const payload: TaskPayload = {
      id: 'edit-1',
      kind: 'edit',
      input: 'in.mp4',
      output: 'out.mp4',
      durationSec: 30,
      edit: {
        trimStartSec: 2,
        trimEndSec: 24,
        cutSegments: [{ startSec: 8, endSec: 10 }, { startSec: 18, endSec: 20 }],
        rotation: { mode: 90, flip: 'none', metadataOnly: false },
        transcode: true,
        backgroundAudio: {
          input: 'bg.mp3',
          originalVolume: 0.6,
          backgroundVolume: 0.9
        }
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
    expect(joined).toContain('trim=');
    expect(joined).toContain('select=');
    expect(joined).toContain('amix');
    expect(joined).toContain('transpose=1');
    expect(joined).toContain('bg.mp3');
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
