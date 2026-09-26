import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUiStore } from '../stores/uiStore';
import { useT } from '../i18n';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * 启动自检提示框：缺失必需组件（ffmpeg / ffprobe）时弹出。
 * 提供「复制安装命令」，并支持键盘快捷键（⌘C/Enter 复制、Esc 关闭）。
 */
export default function MissingBinsModal() {
  const t = useT();
  const bins = useUiStore((s) => s.missingRequiredBins);
  const command = useUiStore((s) => s.installCommand);
  const dismissed = useUiStore((s) => s.missingBinsDismissed);
  const dismiss = useUiStore((s) => s.dismissMissingBins);
  const [copied, setCopied] = useState(false);

  const open = bins.length > 0 && !dismissed;

  const copy = async () => {
    const ok = await window.api.clipboardWrite(command);
    setCopied(ok);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismiss();
        return;
      }
      const isCopy = (IS_MAC ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'c';
      if (isCopy || e.key === 'Enter') {
        e.preventDefault();
        void copy();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss, command]);

  if (!open) return null;

  const impact: Record<string, string> = {
    ffmpeg: t('env.missing.impactFfmpeg'),
    ffprobe: t('env.missing.impactFfprobe')
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9995] flex items-center justify-center bg-black/60 p-6"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-amber-500/40 bg-surface-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-surface-600 px-4 py-3">
          <h2 className="text-sm font-semibold text-strong">⚠ {t('env.missing.title')}</h2>
        </div>

        <div className="space-y-3 px-4 py-4 text-xs leading-relaxed text-body">
          <p className="text-muted">{t('env.missing.desc')}</p>

          <ul className="space-y-1.5">
            {bins.map((b) => (
              <li key={b} className="flex gap-2">
                <span className="mono shrink-0 rounded bg-surface-700 px-1.5 py-0.5 text-[11px] text-strong">
                  {b}
                </span>
                <span className="text-muted">{impact[b] ?? ''}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-lg border border-surface-600 bg-surface-900/70 p-2.5">
            <div className="mono select-all whitespace-pre-wrap break-all text-[11px] text-accent">
              {command}
            </div>
          </div>

          <p className="text-faint">{t('env.missing.hint')}</p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-surface-600 px-4 py-3">
          <button className="btn-ghost text-xs" onClick={dismiss}>
            {t('env.missing.close')} (Esc)
          </button>
          <button className="btn-primary text-xs" onClick={() => void copy()}>
            {copied ? `✓ ${t('env.missing.copied')}` : t('env.missing.copy')}
            {copied ? '' : IS_MAC ? ' (⌘C)' : ' (Ctrl+C)'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
