import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC, TARGET } from '@shared/constants';
import { makeOutputPath, type OutputNamingOptions } from '@shared/outputPath';
import type {
  ExpertOptions,
  HWCapability,
  ImportProgressPayload,
  QueueItem,
  SourceInfo
} from '@shared/types';
import { getConfig } from '../config/configStore';
import { detectCached } from '../hardware/detector';
import { expandPaths } from '../media/scan';
import { probe } from '../media/probe';
import { decideSimple } from '../transcoder/simpleDecision';
import { decideExpert } from '../../shared/params';
import { isVideoFile } from '../concat/segmentProbe';
import { broadcast, createThrottledEmitter } from '../utils/broadcast';

async function mapLimit<T, R>(items: T[], limit: number, fn: (i: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= items.length) break;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

interface QueueAddArg {
  filePaths: string[];
  outputDir: string;
  scaleResolution?: boolean;
  mode?: 'simple' | 'expert';
  expert?: ExpertOptions;
  /** 输出命名规则（自定义后缀 / 与原文件同目录）；缺省时取配置里的转码设置 */
  naming?: OutputNamingOptions;
}

const EMPTY_SOURCE: SourceInfo = {
  width: 0,
  height: 0,
  fps: 0,
  durationSec: 0,
  codec: '',
  hasAudio: false
};

let seq = 0;
const nextId = (): string => `q-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** 无法入队时也返回一项，让失败原因在 UI 可见（而不是静默丢弃） */
function errorItem(id: string, file: string, mode: 'simple' | 'expert', scale: boolean, reason: string): QueueItem {
  return {
    id,
    input: file,
    source: { ...EMPTY_SOURCE },
    mode,
    scaleResolution: scale,
    resolved: null,
    decision: { action: 'no-op', reason, params: null },
    outputDir: '',
    status: 'error',
    error: reason
  };
}

/** 拖拽入队（C9）：批量探针 + 逐项决策 */
export function registerQueueIpc(): void {
  ipcMain.handle(IPC.QUEUE_ADD, async (_e, arg: QueueAddArg): Promise<QueueItem[]> => {
    const cfg = getConfig();
    const scale = arg.scaleResolution ?? cfg.simpleMode.scaleResolution;
    const mode = arg.mode ?? (cfg.simpleMode.enabled ? 'simple' : 'expert');
    const scanEmit = createThrottledEmitter<ImportProgressPayload>(
      (p) => broadcast(IPC.EVT_IMPORT_PROGRESS, p),
      100
    );

    // 支持文件夹导入：递归展开所有子文件夹中的视频文件（带扫描进度）
    const expanded = expandPaths(
      (arg.filePaths ?? []).filter((p): p is string => Boolean(p)),
      (found, folders) => {
        scanEmit({ phase: 'scan', done: found, total: 0, found, folders });
      }
    );
    const candidates = expanded.files;

    // 探针 + 决策阶段进度
    let done = 0;
    scanEmit({ phase: 'probe', done: 0, total: candidates.length }, true);

    // 硬件侦测失败不应阻断入队
    let capability: HWCapability | undefined;
    if (cfg.hardware.autoDetect) {
      try {
        capability = await detectCached();
      } catch (e) {
        console.warn('[queue] 显卡侦测失败，按软件编码处理：', e);
        capability = undefined;
      }
    }

    const processOne = async (file: string): Promise<QueueItem> => {
      const id = nextId();

      if (!fs.existsSync(file)) {
        return errorItem(id, file, mode, scale, '文件不存在或无法访问');
      }
      if (!isVideoFile(file)) {
        const ext = path.extname(file) || '（无扩展名）';
        return errorItem(id, file, mode, scale, `不支持的格式：${ext}`);
      }

      let source: SourceInfo;
      try {
        source = await probe(file, cfg.paths.ffprobe || undefined);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorItem(id, file, mode, scale, `无法读取媒体信息：${msg.split('\n')[0]}`);
      }

      // 宽高都为 0 说明不是有效的视频轨道
      if (!source.height && !source.width) {
        return errorItem(id, file, mode, scale, '未检测到视频轨道');
      }

      const decision =
        mode === 'expert' && arg.expert
          ? decideExpert(source, arg.expert, capability)
          : decideSimple(source, {
              scaleResolution: scale,
              codec: cfg.simpleMode.videoCodec,
              container: cfg.simpleMode.container,
              capability,
              preferredHW: cfg.transcode.preferredHW,
              target: cfg.simpleMode.target ?? TARGET
            });

      const outputDir = arg.outputDir ?? cfg.paths.outputDir ?? '';
      // 命名规则由渲染进程显式传入（转码页的「自定义后缀 / 与原文件同目录」）；
      // 其它页面不传 → 保持任务类型默认后缀。
      const naming: OutputNamingOptions | undefined = arg.naming;
      return {
        id,
        input: file,
        source,
        mode,
        scaleResolution: scale,
        resolved: decision.action === 'no-op' ? null : decision.params,
        decision,
        outputDir,
        status: decision.action === 'no-op' ? 'skipped' : 'pending',
        output:
          decision.action === 'no-op'
            ? ''
            : makeOutputPath(
                file,
                outputDir,
                decision.params?.container ?? 'mp4',
                'transcode',
                naming
              )
      };
    };

    // 逐条推送探针进度（最后一条强制发送）
    return mapLimit(candidates, 4, async (file): Promise<QueueItem> => {
      const item = await processOne(file);
      done += 1;
      scanEmit({ phase: 'probe', done, total: candidates.length }, done === candidates.length);
      return item;
    });
  });
}


