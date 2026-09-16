import { importPercent, useImportStore } from '../stores/importStore';
import { useT } from '../i18n';

/** 导入进度条（文件夹扫描 / 批量解析），完成后自动消失 */
export default function ImportProgress() {
  const t = useT();
  const active = useImportStore((s) => s.active);
  const phase = useImportStore((s) => s.phase);
  const done = useImportStore((s) => s.done);
  const total = useImportStore((s) => s.total);
  const found = useImportStore((s) => s.found);

  if (!active) return null;

  const indeterminate = phase === 'scan' || !total;
  const percent = importPercent({ done, total });

  return (
    <div
      data-import-progress
      data-phase={phase}
      className="pointer-events-none fixed bottom-5 left-1/2 z-[9900] w-[380px] -translate-x-1/2"
    >
      <div className="rounded-xl border border-surface-600 bg-surface-800/95 px-4 py-3 shadow-2xl">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-medium text-body">
            {phase === 'scan' ? t('import.scanning') : t('import.parsing')}
          </span>
          <span className="text-faint">
            {phase === 'scan' ? t('import.found', { n: found }) : `${done} / ${total}`}
          </span>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-600">
          {indeterminate ? (
            <div className="h-full w-1/3 animate-[importSlide_1.1s_ease-in-out_infinite] rounded-full bg-brand-500" />
          ) : (
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-200"
              style={{ width: `${percent}%` }}
            />
          )}
        </div>

        {phase === 'scan' && (
          <p className="mt-1.5 text-[11px] text-faint">{t('import.scanningHint')}</p>
        )}
      </div>
    </div>
  );
}
