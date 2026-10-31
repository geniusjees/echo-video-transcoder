import { MAX_SUFFIX_LENGTH, type SuffixValidation } from '@shared/outputPath';
import { useT } from '../i18n';

interface Props {
  /** 标题（不同页面文案不同，缺省用通用文案） */
  title?: string;
  /** 是否追加后缀 */
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  /** 后缀文本（未 trim 的原始输入） */
  value: string;
  onValueChange: (v: string) => void;
  /** 校验结果（勾选状态下有效） */
  validation: SuffixValidation;
  /** 输出到原文件同目录 */
  sameAsSource: boolean;
  /** 示例文件名，用于预览 */
  example?: string;
}

/**
 * 「转码后是否添加后缀」设置：
 * - 勾选后显示最长 16 字符的输入框，输入内容按所有操作系统的文件名规则校验
 * - 与原文件同目录且未设置后缀 → 会覆盖原文件（醒目提示）
 */
export default function SuffixOptions({
  title,
  checked,
  onCheckedChange,
  value,
  onValueChange,
  validation,
  sameAsSource,
  example
}: Props) {
  const t = useT();

  const errorText = (): string | null => {
    if (!checked || validation.ok) return null;
    switch (validation.code) {
      case 'empty':
        return t('suffix.error.empty');
      case 'tooLong':
        return t('suffix.error.tooLong', { n: MAX_SUFFIX_LENGTH });
      case 'invalidChar':
        return t('suffix.error.invalidChar', { chars: (validation.chars ?? []).join(' ') });
      case 'controlChar':
        return t('suffix.error.controlChar');
      case 'trailingDot':
        return t('suffix.error.trailingDot');
      default:
        return null;
    }
  };

  const error = errorText();
  const overwrite = sameAsSource && !checked;

  return (
    <div className="card space-y-2">
      <label className="flex items-center justify-between rounded-md border border-divider bg-soft px-2 py-1.5 text-xs text-strong">
        <span>{title ?? t('suffix.title')}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
        />
      </label>

      {checked && (
        <>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1"
              value={value}
              maxLength={MAX_SUFFIX_LENGTH}
              onChange={(e) => onValueChange(e.target.value)}
              placeholder={t('suffix.placeholder')}
              spellCheck={false}
            />
            <span className="shrink-0 text-xs text-faint">
              {Array.from(value).length}/{MAX_SUFFIX_LENGTH}
            </span>
          </div>
          {example && <p className="mono text-xs text-muted">{example}</p>}
        </>
      )}

      {error && <p className="text-xs text-err">{error}</p>}

      {overwrite && (
        <p className="rounded-md border border-errline bg-err-bg px-2 py-1.5 text-xs text-err">
          {t('suffix.overwriteWarn')}
        </p>
      )}
    </div>
  );
}
