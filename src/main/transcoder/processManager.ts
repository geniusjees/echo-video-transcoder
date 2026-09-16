import { spawn, type ChildProcess } from 'node:child_process';
import { ProgressParser, type ParsedProgress } from './progressParser';

export interface RunHooks {
  onProgress?: (p: ParsedProgress) => void;
  onLog?: (line: string) => void;
  onStdout?: (line: string) => void;
}

export interface RunResult {
  code: number;
  cancelled: boolean;
  error?: string;
}

export interface RunningProcess {
  promise: Promise<RunResult>;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  getPid: () => number | undefined;
}

/**
 * spawn 封装：进度解析 / 日志 / 取消 / 暂停（§10.7）
 * 暂停说明：POSIX 用 SIGSTOP/SIGCONT；Windows 无等价信号，
 * 由上层按"当前任务完成后不再调度下一个"实现队列级暂停。
 */
export function runProcess(
  cmd: string,
  args: string[],
  opts: { durationSec?: number; cwd?: string } & RunHooks = {}
): RunningProcess {
  const parser = new ProgressParser(opts.durationSec ?? 0);
  let cancelled = false;
  let paused = false;
  let child: ChildProcess;

  const promise = new Promise<RunResult>((resolve) => {
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      resolve({ code: -1, cancelled: false, error: String(e) });
      return;
    }

    const flushTail = (buf: string) => {
      const rest = buf.trim();
      if (rest) opts.onLog?.(rest);
    };

    let stderrBuf = '';
    let stdoutBuf = '';

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      const parsed = parser.push(text);
      if (parsed) opts.onProgress?.(parsed);
      // 结构化进度之外的输出也转发为日志（如 yt-dlp 的普通输出）
      stdoutBuf += text;
      if (stdoutBuf.includes('\n')) {
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) opts.onStdout?.(line.trim());
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      stderrBuf += text;
      if (stderrBuf.length > 64 * 1024) stderrBuf = stderrBuf.slice(-32 * 1024);
      // 按行推送日志
      let idx: number;
      let acc = '';
      const chunk = text;
      let rest = chunk;
      while ((idx = rest.indexOf('\n')) >= 0) {
        acc = rest.slice(0, idx).trim();
        rest = rest.slice(idx + 1);
        if (acc) opts.onLog?.(acc);
      }
      if (rest.trim()) opts.onLog?.(rest.replace(/\r/g, '').trim());
    });

    child.on('error', (err) => {
      resolve({ code: -1, cancelled, error: String(err) });
    });

    child.on('close', (code) => {
      flushTail(stdoutBuf);
      if (cancelled) {
        resolve({ code: code ?? -1, cancelled: true });
        return;
      }
      if (code === 0) {
        opts.onProgress?.({
          frame: 0,
          fps: 0,
          speed: 0,
          outTimeSec: opts.durationSec ?? 0,
          percent: 100,
          done: true
        });
        resolve({ code: 0, cancelled: false });
        return;
      }
      resolve({
        code: code ?? -1,
        cancelled: false,
        error: stderrBuf.split('\n').filter(Boolean).slice(-8).join('\n') || `退出码 ${code}`
      });
    });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child?.pid), '/f', '/t'], { windowsHide: true });
        } else {
          child?.kill('SIGKILL');
        }
      } catch {
        /* ignore */
      }
    },
    pause: () => {
      if (paused) return;
      paused = true;
      try {
        if (process.platform !== 'win32' && child?.pid) process.kill(child.pid, 'SIGSTOP');
      } catch {
        /* ignore */
      }
    },
    resume: () => {
      if (!paused) return;
      paused = false;
      try {
        if (process.platform !== 'win32' && child?.pid) process.kill(child.pid, 'SIGCONT');
      } catch {
        /* ignore */
      }
    },
    getPid: () => child?.pid
  };
}

/** 同步封装：返回 stdout（用于 ffmpeg -encoders / ffprobe 等） */
export function execCapture(
  cmd: string,
  args: string[],
  timeoutMs = 20000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr });
    });
  });
}
