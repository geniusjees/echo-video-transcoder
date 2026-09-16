import { useT } from '../i18n';
import { useThemeStore, type ThemeMode } from '../stores/themeStore';

const ORDER: ThemeMode[] = ['dark', 'light', 'system'];

/** 主题选择（下拉框）：深色 / 浅色 / 跟随系统 */
export default function ThemeSwitch({ onChange }: { onChange?: (mode: ThemeMode) => void }) {
  const t = useT();
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  return (
    <select
      title={t('theme.label')}
      aria-label={t('theme.label')}
      className="rounded-lg border border-surface-600 bg-surface-700 px-2 py-1 text-xs text-body outline-none focus:border-brand-500"
      value={mode}
      onChange={(e) => {
        const next = e.target.value as ThemeMode;
        setMode(next);
        onChange?.(next);
      }}
    >
      {ORDER.map((m) => (
        <option key={m} value={m}>
          {t(`theme.${m}`)}
        </option>
      ))}
    </select>
  );
}
