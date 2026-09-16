import type { ProgressPayload, TaskStatus } from '@shared/types';
import { formatDuration } from '../utils/format';
import { useT } from '../i18n';

const STATUS_TONE: Record<TaskStatus, string> = {
  pending: 'bg-surface-600 text-body',
  running: 'bg-brand-500/15 text-accent',
  done: 'bg-ok-bg text-ok-strong',
  skipped: 'bg-surface-600 text-muted',
  error: 'bg-err-bg text-err-strong',
  cancelled: 'bg-warn-bg text-warn-strong'
};

export function StatusChip({ status }: { status: TaskStatus }) {
  const t = useT();
  return <span className={`chip ${STATUS_TONE[status]}`}>{t(`status.${status}`)}</span>;
}

export default function ProgressBar({ progress }: { progress?: ProgressPayload }) {
  const t = useT();
  const percent = Math.min(100, Math.max(0, progress?.percent ?? 0));
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-600">
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-faint">
        <span>{percent.toFixed(1)}%</span>
        <span>
          {progress?.speed ? `${progress.speed.toFixed(2)}x` : ''}
          {progress?.fps ? ` · ${progress.fps.toFixed(0)}fps` : ''}
          {progress?.etaSec ? ` · ${t('progress.remaining')} ${formatDuration(progress.etaSec)}` : ''}
        </span>
      </div>
    </div>
  );
}
