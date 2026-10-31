import { useState } from 'react';
import { useT } from '../i18n';

interface Props {
  value: string;
  onChange: (dir: string) => void;
  /** C10：普通模式必填 */
  required?: boolean;
  /** 禁用输入与浏览（如勾选「与原文件同一文件夹」） */
  disabled?: boolean;
  /** 显示「与原文件同一文件夹」勾选框 */
  showSameAsSource?: boolean;
  sameAsSource?: boolean;
  onSameAsSourceChange?: (v: boolean) => void;
}

/** 输出文件夹选择（C10）：未指定时上层应禁用「开始」 */
export default function OutputFolderPicker({
  value,
  onChange,
  required,
  disabled,
  showSameAsSource,
  sameAsSource,
  onSameAsSourceChange
}: Props) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  const browse = async () => {
    if (disabled) return;
    const res = await window.api.selectOutputDir(value);
    if (!res) return;
    if (res.dir) {
      setError(null);
      onChange(res.dir);
    } else if (res.error) {
      setError(res.error);
    }
  };

  return (
    <div>
      <label className="label">
        {t('out.label')} {required && !disabled && <span className="text-err">*</span>}
      </label>
      <div className="flex gap-2">
        {/* 只读：输出目录必须通过「浏览」选择，避免手输路径与实际生效目录不一致 */}
        <input
          className={`input flex-1 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-default'}`}
          placeholder={
            disabled
              ? t('out.sameAsSourceActive')
              : required
                ? t('out.placeholder')
                : t('out.placeholderOptional')
          }
          value={disabled ? t('out.sameAsSourceActive') : value}
          readOnly
          disabled={disabled}
          title={t('out.readonlyHint')}
        />
        <button className="btn-ghost shrink-0" onClick={browse} disabled={disabled}>
          {t('out.browse')}
        </button>
        {value && !disabled && (
          <button className="btn-ghost shrink-0" onClick={() => window.api.openPath(value)}>
            {t('out.open')}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-err">{error}</p>}
      {required && !value && !error && !disabled && (
        <p className="mt-1 text-xs text-warn">{t('out.needSelect')}</p>
      )}
      {showSameAsSource && (
        <label className="mt-2 flex items-center justify-between rounded-md border border-divider bg-soft px-2 py-1.5 text-xs text-strong">
          <span>{t('out.sameAsSource')}</span>
          <input
            type="checkbox"
            checked={Boolean(sameAsSource)}
            onChange={(e) => onSameAsSourceChange?.(e.target.checked)}
          />
        </label>
      )}
      {showSameAsSource && sameAsSource && (
        <p className="mt-1 text-xs text-muted">{t('out.sameAsSourceHint')}</p>
      )}
    </div>
  );
}
