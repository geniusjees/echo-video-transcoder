import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  /** 每次击键提交合法值（on change 生效，不需要失焦） */
  onChange: (v: number) => void;
  /** 允许输入小数 */
  decimal?: boolean;
  min?: number;
  max?: number;
  className?: string;
  placeholder?: string;
}

/**
 * 规整数字文本：
 * - 只保留数字与最多一个小数点
 * - 去掉多余的前导 0：`0192` → `192`，`00.5` → `0.5`，`0.5` 保留
 */
export function normalizeNumberText(raw: string, decimal: boolean): string {
  let s = raw.replace(decimal ? /[^\d.]/g : /[^\d]/g, '');
  if (decimal) {
    const first = s.indexOf('.');
    if (first >= 0) {
      s = `${s.slice(0, first + 1)}${s.slice(first + 1).replace(/\./g, '')}`;
    }
  }
  // 整数部分多于一位时去掉前导 0；"0.5" 这种只保留一个 0
  s = s.replace(/^0+(?=\d)/, '');
  if (decimal) s = s.replace(/^0+(?=\.)/, '0');
  return s;
}

/**
 * 数字输入框：
 * - **on change 即时提交**合法值（失焦只做兜底归一化），
 *   避免「调完参数直接点开始，仍用旧值」；
 * - 输入时去掉多余前导 0；
 * - 空串 / 非数字 / 越界的中间态不写入状态，避免把 0 或 NaN 交给 ffmpeg。
 */
export default function NumberField({
  value,
  onChange,
  decimal = false,
  min,
  max,
  className = 'input',
  placeholder
}: Props) {
  const [text, setText] = useState(() => String(value));
  const focused = useRef(false);

  // 外部改动（切换预设等）时同步；用户正在输入则不打断
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const cleaned = normalizeNumberText(raw, decimal);
    setText(cleaned);
    if (!cleaned || cleaned === '.') return;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return;
    if (min !== undefined && n < min) return;
    if (max !== undefined && n > max) return;
    if (n !== value) onChange(n);
  };

  /** 失焦：空值回退已提交值，越界值夹到边界 */
  const handleBlur = () => {
    focused.current = false;
    let n = Number(normalizeNumberText(text, decimal));
    if (!Number.isFinite(n) || normalizeNumberText(text, decimal) === '') n = value;
    if (min !== undefined) n = Math.max(n, min);
    if (max !== undefined) n = Math.min(n, max);
    setText(String(n));
    if (n !== value) onChange(n);
  };

  return (
    <input
      className={className}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      autoComplete="off"
      spellCheck={false}
      value={text}
      placeholder={placeholder}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => commit(e.target.value)}
      onBlur={handleBlur}
    />
  );
}
