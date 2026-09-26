import { useState } from 'react';
import type { HWCapability } from '@shared/types';
import { useConfigStore } from '../stores/configStore';
import { useT } from '../i18n';

/**
 * 显卡徽标（含 Apple MPS，C4）
 * 点击可强制重新侦测：避免侦测失败/热更新重置后永久停在「侦测中」。
 */
export default function HardwareBadge({ capability }: { capability: HWCapability | null }) {
  const t = useT();
  const detect = useConfigStore((s) => s.detect);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await detect(true);
    } catch {
      /* 失败时保持原状态；错误已写入日志面板 */
    } finally {
      setBusy(false);
    }
  };

  const isSoftware = capability?.recommended === 'software';
  const label = capability ? t(`hw.${capability.recommended}`) : t('hw.detecting');
  const title = capability
    ? `${capability.platform} / ${capability.arch} · ${t('hw.redetect')}`
    : t('hw.redetect');

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={busy}
      title={title}
      className={`chip ${
        isSoftware || !capability ? 'bg-surface-600 text-body' : 'bg-brand-500/15 text-accent'
      }`}
    >
      {capability && !isSoftware ? '⚡' : '⚙'} {label}
    </button>
  );
}
