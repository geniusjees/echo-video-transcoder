import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQueueStore } from '../stores/queueStore';
import { useUiStore } from '../stores/uiStore';
import { useT } from '../i18n';

/** 日志弹窗（由「操作」模块的按钮唤出） */
export default function LogModal() {
  const t = useT();
  const open = useUiStore((s) => s.logOpen);
  const setOpen = useUiStore((s) => s.setLogOpen);
  const logs = useQueueStore((s) => s.logs);
  const clearLogs = useQueueStore((s) => s.clearLogs);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/50 p-6"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex h-[70vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-surface-600 bg-surface-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-surface-600 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-strong">{t('log.title')}</span>
            <span className="chip bg-surface-700 text-muted">
              {t('log.count', { n: logs.length })}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <button className="text-muted hover:text-body" onClick={clearLogs}>
              {t('log.clear')}
            </button>
            <button className="text-muted hover:text-body" onClick={() => setOpen(false)}>
              {t('log.close')} ✕
            </button>
          </div>
        </div>

        <div
          ref={bodyRef}
          className="mono flex-1 overflow-auto bg-surface-900/60 p-4 text-[11px] leading-relaxed text-muted"
        >
          {logs.length === 0 ? (
            <p className="text-faint">{t('log.empty')}</p>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {l}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
