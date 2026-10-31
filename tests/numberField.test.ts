import { describe, expect, it } from 'vitest';
import { normalizeNumberText } from '../src/renderer/components/NumberField';

describe('数字输入规整（on change 去前导 0）', () => {
  it('整数：去掉多余前导 0', () => {
    expect(normalizeNumberText('0192', false)).toBe('192');
    expect(normalizeNumberText('0026', false)).toBe('26');
    expect(normalizeNumberText('000', false)).toBe('0');
    expect(normalizeNumberText('0', false)).toBe('0');
  });

  it('小数：保留 0.5 这类唯一的 0', () => {
    expect(normalizeNumberText('0.5', true)).toBe('0.5');
    expect(normalizeNumberText('00.5', true)).toBe('0.5');
    expect(normalizeNumberText('0192.5', true)).toBe('192.5');
  });

  it('过滤非数字字符与多余小数点', () => {
    expect(normalizeNumberText('ab12', false)).toBe('12');
    expect(normalizeNumberText('12abc', false)).toBe('12');
    expect(normalizeNumberText('1.2.3', true)).toBe('1.23');
  });

  it('空值保持为空（不提交，失焦时回退）', () => {
    expect(normalizeNumberText('', false)).toBe('');
    expect(normalizeNumberText('abc', false)).toBe('');
  });
});
