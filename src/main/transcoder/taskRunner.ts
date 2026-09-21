import { app, dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../config/configStore';
import {
  formatConcatCancelMessage,
  formatConcatConflictPrompt,
  resolveConcatDialogLocale
} from '@shared/concatI18n';
import type { ProgressPayload, SourceInfo, TaskPayload, TaskStatus } from '@shared/types';
import {
  buildAlignedListFile,
  buildConcatCopyArgs,
  buildConcatListFile,
  buildSegmentAlignArgs
} from '../concat/commandBuilder';
import { probe } from '../media/probe';
import { ffmpegPath } from '../utils/paths';
import { buildArgsForTask, toCommandString, type CommandContext } from './commandBuilder';
import { runProcess, type RunningProcess } from './processManager';

export interface TaskEvents {
  onProgress?: (p: ProgressPayload) => void;
  onLog?: (line: string) => void;
  onStatus?: (id: string, status: TaskStatus, extra?: { error?: string; output?: string }) => void;
  onCommand?: (id: string, command: string) => void;
  /** 开始有任务运行（用于阻止休眠） */
  onBusy?: () => void;
  /** 所有任务结束 */
  onIdle?: () => void;
}

interface RunningEntry {
  payload: TaskPayload;
  proc: RunningProcess;
}

const EMPTY_SOURCE: SourceInfo = {
  width: 0,
  height: 0,
  fps: 0,
  durationSec: 0,
  codec: '',
  hasAudio: false
};

/**
 * 任务调度：转码 / 压缩 / 旋转 / 提取音频 / 拼接 / 下载
 * 支持并发上限（config.transcode.parallelJobs，默认 1）、取消、暂停。
 */
export class TaskRunner {
  private running = new Map<string, RunningEntry>();
  private cancelled = new Set<string>();
  private paused = false;
  private taskId = 'task';
  private ctx: CommandContext = {};

  constructor(private events: TaskEvents = {}, private parallelJobs = 1) {}

  setContext(ctx: CommandContext): void {
    this.ctx = ctx;
  }

  setParallelJobs(n: number): void {
    this.parallelJobs = Math.max(1, n);
  }

  setEvents(events: TaskEvents): void {
    this.events = events;
  }

  get activeCount(): number {
    return this.running.size;
  }

  /** 启动一批任务（受并发上限限制） */
  async runAll(payloads: TaskPayload[]): Promise<void> {
    this.taskId = payloads[0]?.id ? `${payloads[0].id}-${Date.now()}` : `task-${Date.now()}`;
    const queue = [...payloads];
    if (!queue.length) return;
    // 任务期间阻止机器休眠（§15.6 新增）
    this.events.onBusy?.();
    try {
      const workers = new Array(Math.min(this.parallelJobs, queue.length))
        .fill(0)
        .map(async () => {
          for (;;) {
            if (this.paused) {
              await sleep(300);
              continue;
            }
            const payload = queue.shift();
            if (!payload) break;
            if (this.cancelled.has(payload.id)) {
              this.emitStatus(payload.id, 'cancelled');
              continue;
            }
            await this.runOne(payload);
          }
        });
      await Promise.all(workers);
    } finally {
      this.events.onIdle?.();
    }
  }

  private emitStatus(id: string, status: TaskStatus, extra?: { error?: string; output?: string }) {
    this.events.onStatus?.(id, status, extra);
  }

  private emitProgress(payload: TaskPayload, p: Partial<ProgressPayload>, status: TaskStatus) {
    this.events.onProgress?.({
      id: payload.id,
      taskId: this.taskId,
      percent: 0,
      frame: 0,
      fps: 0,
      speed: 0,
      outTimeSec: 0,
      ...p,
      status
    } as ProgressPayload);
  }

  async runOne(payload: TaskPayload): Promise<void> {
    if (this.cancelled.has(payload.id)) {
      this.emitStatus(payload.id, 'cancelled');
      return;
    }
    this.emitStatus(payload.id, 'running');
    try {
      if (payload.kind === 'concat') {
        await this.runConcat(payload);
      } else {
        await this.runFfmpeg(payload);
      }
      if (this.cancelled.has(payload.id)) {
        this.emitStatus(payload.id, 'cancelled');
        return;
      }
      this.emitProgress(payload, { percent: 100 }, 'done');
      this.emitStatus(payload.id, 'done', { output: payload.output });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.events.onLog?.(`[错误] ${payload.input} → ${message}`);
      this.emitStatus(payload.id, 'error', { error: message });
    }
  }

  private async runFfmpeg(payload: TaskPayload): Promise<void> {
    const source = await safeProbe(payload.input);
    const duration = payload.durationSec || source.durationSec;
    const args = buildArgsForTask(payload, source, this.ctx);
    const bin = ffmpegPath();
    this.events.onCommand?.(payload.id, toCommandString(bin, args));

    const proc = runProcess(bin, args, {
      durationSec: duration,
      onProgress: (p) =>
        this.emitProgress(
          payload,
          {
            percent: p.percent,
            frame: p.frame,
            fps: p.fps,
            speed: p.speed,
            outTimeSec: p.outTimeSec,
            etaSec: p.speed > 0 && duration > 0 ? Math.max(0, (duration - p.outTimeSec) / p.speed) : undefined
          },
          'running'
        ),
      onLog: (line) => this.events.onLog?.(line)
    });
    this.running.set(payload.id, { payload, proc });
    const res = await proc.promise;
    this.running.delete(payload.id);

    if (this.cancelled.has(payload.id)) {
      const locale = resolveConcatDialogLocale(getConfig().language, app.getLocale?.() ?? undefined);
      throw new Error(formatConcatCancelMessage(locale));
    }
    if (res.code !== 0) throw new Error(res.error || `ffmpeg exit code ${res.code}`);
  }

  /** 拼接：先（可选）转码对齐，再 concat（§10.6） */
  private async runConcat(payload: TaskPayload): Promise<void> {
    const { segments, plan } = payload.concat!;
    if (!segments.length) throw new Error('没有可拼接的片段');

    const decision = await resolveConcatOutputPathWithPrompt(payload.output);
    if (decision.action === 'cancel') {
      const locale = resolveConcatDialogLocale(getConfig().language, app.getLocale?.() ?? undefined);
      throw new Error(formatConcatCancelMessage(locale));
    }
    payload.output = decision.output;

    const workDir = path.join(os.tmpdir(), 'video-transcoder', `concat-${payload.id}`);
    fs.mkdirSync(workDir, { recursive: true });
    const bin = ffmpegPath();

    const steps = plan.strategy === 'copy' ? 1 : segments.length + 1;
    let doneSteps = 0;
    const stepBase = () => (doneSteps / steps) * 100;

    const runStep = async (
      args: string[],
      id: string,
      durationSec: number,
      label: string
    ): Promise<void> => {
      this.events.onCommand?.(id, toCommandString(bin, args));
      this.events.onLog?.(`[拼接] ${label}`);
      const proc = runProcess(bin, args, {
        durationSec,
        onProgress: (p) =>
          this.emitProgress(
            payload,
            {
              percent: Math.min(99.5, stepBase() + p.percent / steps),
              frame: p.frame,
              fps: p.fps,
              speed: p.speed,
              outTimeSec: p.outTimeSec
            },
            'running'
          ),
        onLog: (line) => this.events.onLog?.(line)
      });
      this.running.set(payload.id, { payload, proc });
      const res = await proc.promise;
      this.running.delete(payload.id);
      if (this.cancelled.has(payload.id)) {
        const locale = resolveConcatDialogLocale(getConfig().language, app.getLocale?.() ?? undefined);
        throw new Error(formatConcatCancelMessage(locale));
      }
      if (res.code !== 0) throw new Error(res.error || `Concat failed: ${label}`);
      doneSteps += 1;
    };

    if (plan.strategy === 'copy') {
      const listFile = buildConcatListFile(segments, workDir);
      await runStep(buildConcatCopyArgs(listFile, payload.output), payload.id, plan.totalDurationSec, '纯拼接（-c copy）');
    } else {
      const aligned: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const out = path.join(workDir, `seg_${String(i + 1).padStart(2, '0')}.conv.mp4`);
        const dur = seg.trim
          ? Math.max(0, (seg.trim.endSec || seg.source.durationSec) - seg.trim.startSec)
          : seg.source.durationSec;
        await runStep(
          buildSegmentAlignArgs(seg, out, plan.uniform, this.ctx),
          payload.id,
          dur,
          `转码对齐 ${i + 1}/${segments.length}：${path.basename(seg.input)}`
        );
        aligned.push(out);
      }
      const listFile = buildAlignedListFile(aligned, workDir);
      await runStep(
        buildConcatCopyArgs(listFile, payload.output),
        payload.id,
        plan.totalDurationSec,
        '合并（concat -c copy）'
      );
      // 清理中间文件
      try {
        for (const f of aligned) fs.rmSync(f, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  cancel(id?: string): void {
    if (id) {
      this.cancelled.add(id);
      const entry = this.running.get(id);
      entry?.proc.cancel();
      this.running.delete(id);
    } else {
      for (const [key, entry] of this.running) {
        this.cancelled.add(key);
        entry.proc.cancel();
      }
      this.running.clear();
    }
  }

  pause(): void {
    this.paused = true;
    for (const [, entry] of this.running) entry.proc.pause();
  }

  resume(): void {
    this.paused = false;
    for (const [, entry] of this.running) entry.proc.resume();
  }

  isPaused(): boolean {
    return this.paused;
  }

  resetCancelled(id?: string): void {
    if (id) this.cancelled.delete(id);
    else this.cancelled.clear();
  }
}

export type ConcatOutputAction = 'overwrite' | 'rename' | 'cancel';

export { formatConcatConflictPrompt, resolveConcatDialogLocale };

export function resolveConcatOutputPath(
  output: string,
  nextIndexFactory: (n: number) => number = (n) => n
): { action: ConcatOutputAction; output: string } {
  if (!output || !fs.existsSync(output)) {
    return { action: 'overwrite', output };
  }

  const dir = path.dirname(output);
  const ext = path.extname(output);
  const base = path.basename(output, ext);
  for (let i = 1; ; i++) {
    const candidate = path.join(dir, `${base} (${nextIndexFactory(i)})${ext}`);
    if (!fs.existsSync(candidate)) {
      return { action: 'rename', output: candidate };
    }
  }
}

async function resolveConcatOutputPathWithPrompt(
  output: string
): Promise<{ action: ConcatOutputAction; output: string }> {
  if (!output || !fs.existsSync(output)) {
    return { action: 'overwrite', output };
  }

  const locale = resolveConcatDialogLocale(getConfig().language, app.getLocale?.() ?? undefined);
  const prompt = formatConcatConflictPrompt(locale, path.basename(output));
  const res = await dialog.showMessageBox({
    type: 'warning',
    title: prompt.title,
    message: prompt.message,
    buttons: prompt.buttons,
    defaultId: 0,
    cancelId: prompt.buttons.length - 1,
    noLink: true
  });

  if (res.response === 0) {
    return { action: 'overwrite', output };
  }
  if (res.response === 1) {
    return resolveConcatOutputPath(output);
  }
  return { action: 'cancel', output };
}

async function safeProbe(input: string): Promise<SourceInfo> {
  try {
    if (!input || !fs.existsSync(input)) return { ...EMPTY_SOURCE };
    return await probe(input);
  } catch {
    return { ...EMPTY_SOURCE };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
