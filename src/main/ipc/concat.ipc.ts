import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import type { ConcatPlan, ResolvedParams, Segment, SegmentInfo } from '@shared/types';
import { getConfig } from '../config/configStore';
import { planConcat, type PlanOptions } from '../concat/concatPlanner';
import { previewSegments, probeSegments } from '../concat/segmentProbe';
import { detectCached } from '../hardware/detector';
import { expandPaths } from '../media/scan';

interface PlanArg {
  inputs?: string[];
  segments?: Segment[];
  scaleResolution?: boolean;
  expert?: ResolvedParams | null;
}

/** 拼接方案 / 片段预览（§10.6） */
export function registerConcatIpc(): void {
  ipcMain.handle(IPC.CONCAT_PLAN, async (_e, arg: PlanArg): Promise<ConcatPlan> => {
    const cfg = getConfig();
    let segments: Segment[] = arg.segments ?? [];
    if (arg.inputs?.length) {
      // 支持文件夹导入：展开子文件夹中的视频
      const files = expandPaths(arg.inputs).files;
      segments = await probeSegments(files, 4, cfg.paths.ffprobe || undefined);
    }
    const capability = cfg.hardware.autoDetect ? await detectCached() : undefined;
    const opts: PlanOptions = {
      scaleResolution: arg.scaleResolution ?? cfg.simpleMode.scaleResolution,
      capability,
      preferredHW: cfg.transcode.preferredHW,
      codec: cfg.simpleMode.videoCodec,
      container: cfg.simpleMode.container,
      target: cfg.simpleMode.target,
      expert: arg.expert ?? undefined
    };
    return planConcat(segments, opts);
  });

  ipcMain.handle(
    IPC.CONCAT_PREVIEW,
    async (_e, arg: { inputs: string[]; withThumbnail?: boolean }): Promise<SegmentInfo[]> => {
      const cfg = getConfig();
      const files = expandPaths(arg.inputs ?? []).files;
      const segments = await probeSegments(files, 4, cfg.paths.ffprobe || undefined);
      return previewSegments(segments, arg.withThumbnail ?? true);
    }
  );
}
