import { useState } from 'react';
import { useT } from '../i18n';

interface Props {
  value: string;
  onChange: (dir: string) => void;
  /** C10：普通模式必填 */
  required?: boolean;
}

/** 输出文件夹选择（C10）：未指定时上层应禁用「开始」 */
export default function OutputFolderPicker({ value, onChange, required }: Props) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  const browse = async () => {
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
        {t('out.label')} {required && <span className="text-err">*</span>}
      </label>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder={required ? t('out.placeholder') : t('out.placeholderOptional')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button className="btn-ghost shrink-0" onClick={browse}>
          {t('out.browse')}
        </button>
        {value && (
          <button className="btn-ghost shrink-0" onClick={() => window.api.openPath(value)}>
            {t('out.open')}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-err">{error}</p>}
      {required && !value && !error && (
        <p className="mt-1 text-xs text-warn">{t('out.needSelect')}</p>
      )}
    </div>
  );
}
