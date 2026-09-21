import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatConcatConflictPrompt, resolveConcatDialogLocale, resolveConcatOutputPath } from '../src/main/transcoder/taskRunner';

describe('拼接输出文件冲突处理', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concat-output-'));

  afterEach(() => {
    for (const f of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  });

  it('重命名时应生成唯一文件名', () => {
    const target = path.join(dir, 'merged.mp4');
    fs.writeFileSync(target, 'old');

    const result = resolveConcatOutputPath(target, () => 1);

    expect(result.action).toBe('rename');
    expect(result.output).not.toBe(target);
    expect(result.output).toBe(path.join(dir, 'merged (1).mp4'));
  });

  it('当目标不存在时不应重命名', () => {
    const target = path.join(dir, 'new.mp4');

    const result = resolveConcatOutputPath(target);

    expect(result.action).toBe('overwrite');
    expect(result.output).toBe(target);
  });

  it('应按当前选定语言显示冲突按钮', () => {
    const locale = resolveConcatDialogLocale('auto', 'fr');
    expect(locale).toBe('fr');

    const prompt = formatConcatConflictPrompt(locale, 'merged.mp4');
    expect(prompt.buttons).toEqual(['Remplacer', 'Renommer', 'Annuler']);
  });
});
