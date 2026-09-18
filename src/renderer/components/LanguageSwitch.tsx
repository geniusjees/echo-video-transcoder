import { LANGUAGE_OPTIONS, localeLabel, useI18nStore, useT } from '../i18n';

/** 语言选择：自动（跟随系统）/ 10 种语言 */
export default function LanguageSwitch({ onChange }: { onChange?: (value: string) => void }) {
  const t = useT();
  const preference = useI18nStore((s) => s.preference);
  const matched = useI18nStore((s) => s.matched);
  const setPreference = useI18nStore((s) => s.setPreference);

  return (
    <select
      title={t('language.switchTitle')}
      aria-label={t('language.switchTitle')}
      className="rounded-lg border border-surface-600 bg-surface-700 px-2 py-1 text-xs text-body outline-none focus:border-brand-500"
      value={preference}
      onChange={(e) => {
        const next = e.target.value;
        setPreference(next);
        onChange?.(next);
      }}
    >
      <option value="auto">{t('language.auto', { label: localeLabel(matched) })}</option>
      {LANGUAGE_OPTIONS.map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
