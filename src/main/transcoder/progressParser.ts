/**
 * FFmpeg 进度解析（§10.7）
 * 读取 `-progress pipe:1 -nostats` 输出的 key=value 结构
 */

export interface ParsedProgress {
  frame: number;
  fps: number;
  /** 倍数，如 2.5 */
  speed: number;
  outTimeSec: number;
  percent: number;
  done: boolean;
  bitrateKbps?: number;
  sizeKb?: number;
}

export class ProgressParser {
  private buf = '';
  private state: Record<string, string> = {};
  private lastPercent = 0;
  private finished = false;

  constructor(private durationSec = 0) {}

  setDuration(sec: number): void {
    this.durationSec = sec;
  }

  /** 喂入 stdout 分片，返回解析出的进度（若有更新） */
  push(chunk: string): ParsedProgress | null {
    this.buf += chunk;
    let idx: number;
    let updated: ParsedProgress | null = null;

    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;

      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();

      if (key === 'progress') {
        if (value === 'end') this.finished = true;
        continue;
      }
      this.state[key] = value;
    }

    if (Object.keys(this.state).length === 0) return null;

    const frame = Number(this.state.frame ?? 0) || 0;
    const fps = Number(this.state.fps ?? 0) || 0;
    const speedRaw = this.state.speed ?? '0';
    const speed = Number(String(speedRaw).replace(/x$/, '')) || 0;
    const outTimeUs = Number(this.state.out_time_us ?? 0);
    const outTimeMs = outTimeUs ? outTimeUs / 1000 : Number(this.state.out_time_ms ?? 0);
    const outTimeSec = outTimeMs / 1000;

    let percent = this.lastPercent;
    if (this.finished) {
      percent = 100;
    } else if (this.durationSec > 0) {
      percent = Math.min(99.5, Math.max(0, (outTimeSec / this.durationSec) * 100));
    }
    // 进度单调不回退
    if (percent < this.lastPercent) percent = this.lastPercent;
    this.lastPercent = percent;

    updated = {
      frame,
      fps,
      speed,
      outTimeSec,
      percent: Math.round(percent * 10) / 10,
      done: this.finished,
      bitrateKbps: Number(this.state.bitrate?.replace(/kbits\/s/, '')) || undefined,
      sizeKb: Number(this.state.total_size) || undefined
    };
    return updated;
  }

  isFinished(): boolean {
    return this.finished;
  }
}
