import { useState } from 'react';
import { useDropStore } from '../stores/dropStore';
import { useT } from '../i18n';

interface Props {
  onFiles: (paths: string[]) => void;
  hint?: string;
  compact?: boolean;
}

/**
 * 拖拽区（C9）
 * 拖放本身由 App 的**窗口级**监听处理（拖到窗口任意位置都生效），
 * 这里只负责视觉提示与「点击选择文件」。
 */
export default function DropZone({ onFiles, hint, compact }: Props) {
  const t = useT();
  const dragging = useDropStore((s) => s.dragging);
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const paths = await window.api.selectFiles();
      if (paths?.length) onFiles(paths);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={pick}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
        compact ? 'gap-1 py-4' : 'gap-2 py-10'
      } ${
        dragging
          ? 'border-brand-500 bg-brand-500/10 text-accent'
          : 'border-surface-600 bg-surface-800/40 text-muted hover:border-surface-500'
      }`}
    >
      <span className={compact ? 'text-xl' : 'text-3xl'}>⬇</span>
      <span className="text-sm font-medium">{hint ?? t('drop.defaultHint')}</span>
      {!compact && <span className="text-xs text-faint">{t('drop.anywhere')}</span>}
    </div>
  );
}
