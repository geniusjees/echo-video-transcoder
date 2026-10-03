import { createPortal } from 'react-dom';
import { useConcatStore } from '../../stores/concatStore';
import { useQueueStore } from '../../stores/queueStore';
import { useT } from '../../i18n';
import { baseName } from '../../utils/format';

/**
 * 拼接子窗体（§13.4）：
 * 运行中显示进度条，完成后提示「拼接完成」，失败则显示错误原因。
 * 进度取自主进程的进度事件（id 与拼接任务一致）。
 */
export default function ConcatProgressDialog() {
  const t = useT();

  const taskId = useConcatStore((s) => s.taskId);
  const status = useConcatStore((s) => s.status);
  const error = useConcatStore((s) => s.error);
  const output = useConcatStore((s) => s.output);
  const plan = useConcatStore((s) => s.plan);
  const closeProgress = useConcatStore((s) => s.closeProgress);
  const cancel = useQueueStore((s) => s.cancel);
  const progress = useQueueStore((s) => (taskId ? s.progress[taskId] : undefined));

  if (!taskId || status === 'idle') return null;

  const percent = status === 'done' ? 100 : Math.min(100, Math.max(0, progress?.percent ?? 0));
  const title =
    status === 'running'
      ? t('concat.progressTitle')
      : status === 'done'
        ? t('concat.progressDone')
        : t('concat.progressFailed');
  const icon = status === 'running' ? '⏳' : status === 'done' ? '✅' : '⚠';

  const strategyText = plan
    ? plan.strategy === 'copy'
      ? t('concat.strategyCopy')
      : t('concat.strategyTranscode')
    : '';

  return createPortal(
    <div className="fixed inset-0 z-[9993] flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-surface-600 bg-surface-800 shadow-2xl">
        <div className="border-b border-surface-600 px-4 py-3">
          <h2 className="text-sm font-semibold text-strong">
            {icon} {title}
          </h2>
        </div>

        <div className="space-y-3 px-4 py-4">
          {status === 'error' ? (
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-err">
              {error || t('concat.progressFailed')}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 text-xs text-faint">
                <span className="truncate">{baseName(output)}</span>
                <span className="shrink-0">{percent.toFixed(1)}%</span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-600">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>

              <p className="break-all text-xs text-faint">{output}</p>

              {status === 'running' && strategyText && (
                <p className="text-xs text-muted">{strategyText}</p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-surface-600 px-4 py-3">
          {status === 'running' ? (
            <button className="btn-ghost text-xs" onClick={() => void cancel(taskId)}>
              {t('op.cancel')}
            </button>
          ) : (
            <>
              {status === 'done' && output && (
                <button
                  className="btn-ghost text-xs"
                  onClick={() => void window.api.openPath(output)}
                >
                  {t('out.open')}
                </button>
              )}
              <button className="btn-primary text-xs" onClick={closeProgress}>
                {t('concat.close')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
