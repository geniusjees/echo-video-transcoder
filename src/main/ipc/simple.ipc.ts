import { ipcMain } from 'electron';
import path from 'node:path';
import { IPC, TARGET } from '@shared/constants';
import type { ExpertOptions, SourceInfo, TaskPayload } from '@shared/types';
import { buildConcatPreviewCommands } from '../concat/commandBuilder';
import { getConfig } from '../config/configStore';
import { detectCached } from '../hardware/detector';
import { probe } from '../media/probe';
import { buildArgsForTask, toCommandString } from '../transcoder/commandBuilder';
import { resolveExpertParams } from '../transcoder/expertParams';
import { decideSimple } from '../transcoder/simpleDecision';
import { ffmpegPath } from '../utils/paths';

/** 决策树 / 参数解析 / 命令预览（§7、C7） */
export function registerSimpleIpc(): void {
  // §7 决策树
  ipcMain.handle(
    IPC.SIMPLE_DECIDE,
    async (_e, arg: { source: SourceInfo; scaleResolution?: boolean }) => {
      const cfg = getConfig();
      const capability = cfg.hardware.autoDetect ? await detectCached() : undefined;
      return decideSimple(arg.source, {
        scaleResolution: arg.scaleResolution ?? cfg.simpleMode.scaleResolution,
        codec: cfg.simpleMode.videoCodec,
        container: cfg.simpleMode.container,
        capability,
        preferredHW: cfg.transcode.preferredHW,
        target: cfg.simpleMode.target ?? TARGET
      });
    }
  );

  // 专家模式参数封顶（§8）
  ipcMain.handle(
    IPC.PARAMS_RESOLVE,
    async (_e, arg: { source: SourceInfo; options: ExpertOptions }) => {
      const cfg = getConfig();
      const capability = cfg.hardware.autoDetect ? await detectCached() : undefined;
      return resolveExpertParams(arg.source, arg.options, capability);
    }
  );

  // 命令预览（C7）
  ipcMain.handle(
    IPC.BUILD_COMMAND,
    async (
      _e,
      arg: { payload: TaskPayload; source?: SourceInfo }
    ): Promise<{ command: string } | { commands: string[] }> => {
      const cfg = getConfig();
      const capability = cfg.hardware.autoDetect ? await detectCached() : undefined;
      const source: SourceInfo =
        arg.source ??
        (arg.payload.input ? await probe(arg.payload.input, cfg.paths.ffprobe || undefined) : ({} as SourceInfo));
      if (arg.payload.kind === 'concat') {
        const workDir = path.join(
          arg.payload.output ? path.dirname(arg.payload.output) : '.',
          '.concat-work'
        );
        const commands = buildConcatPreviewCommands(
          arg.payload.concat!.plan,
          workDir,
          arg.payload.output,
          { capability, preferredHW: cfg.transcode.preferredHW }
        );
        return { commands };
      }
      const args = buildArgsForTask(arg.payload, source, {
        capability,
        preferredHW: cfg.transcode.preferredHW
      });
      return { command: toCommandString(ffmpegPath(cfg.paths.ffmpeg || undefined), args) };
    }
  );
}
