import type { HWCapability } from '@shared/types';
import { useT } from '../i18n';

/** 显卡徽标（含 Apple MPS，C4） */
export default function HardwareBadge({ capability }: { capability: HWCapability | null }) {
  const t = useT();

  if (!capability) {
    return <span className="chip bg-surface-600 text-body">{t('hw.detecting')}</span>;
  }
  const isSoftware = capability.recommended === 'software';
  return (
    <span
      className={`chip ${
        isSoftware ? 'bg-surface-600 text-body' : 'bg-brand-500/15 text-accent'
      }`}
      title={`${capability.platform} / ${capability.arch}`}
    >
      {isSoftware ? '⚙' : '⚡'} {t(`hw.${capability.recommended}`)}
    </span>
  );
}
