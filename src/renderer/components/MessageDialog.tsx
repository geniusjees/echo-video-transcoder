import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDialogStore } from '../stores/dialogStore';
import { useT } from '../i18n';

/**
 * 应用内消息弹窗：标题 / 正文 / 按钮文案全部走 i18n，
 * 因此始终跟随软件界面语言（不受系统语言影响）。
 */
export default function MessageDialog() {
  const t = useT();
  const open = useDialogStore((s) => s.open);
  const kind = useDialogStore((s) => s.kind);
  const title = useDialogStore((s) => s.title);
  const message = useDialogStore((s) => s.message);
  const close = useDialogStore((s) => s.close);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9996] flex items-center justify-center bg-black/60 p-6"
      onClick={() => close(false)}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-xl border border-surface-600 bg-surface-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="border-b border-surface-600 px-4 py-3">
            <h2 className="text-sm font-semibold text-strong">{title}</h2>
          </div>
        )}

        <div className="whitespace-pre-wrap break-words px-4 py-4 text-xs leading-relaxed text-body">
          {message}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-surface-600 px-4 py-3">
          {kind === 'confirm' && (
            <button className="btn-ghost text-xs" onClick={() => close(false)}>
              {t('op.cancel')}
            </button>
          )}
          <button className="btn-primary text-xs" onClick={() => close(true)}>
            {t('dialog.ok')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
