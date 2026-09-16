import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { expandPaths, isVideoFilePath, scanVideoFiles } from '../src/main/media/scan';

const created: string[] = [];

/** 每个用例独立的临时目录，避免相互污染 */
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-scan-'));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

describe('文件夹递归导入', () => {
  it('识别视频扩展名', () => {
    expect(isVideoFilePath('x.MP4')).toBe(true);
    expect(isVideoFilePath('x.mkv')).toBe(true);
    expect(isVideoFilePath('x.txt')).toBe(false);
    expect(isVideoFilePath('x')).toBe(false);
  });

  it('递归遍历所有子文件夹，只保留视频文件（跳过隐藏目录）', () => {
    const root = makeTree();
    fs.mkdirSync(path.join(root, 'sub1', 'sub2'), { recursive: true });
    fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a.mp4'), '');
    fs.writeFileSync(path.join(root, 'sub1', 'b.mkv'), '');
    fs.writeFileSync(path.join(root, 'sub1', 'sub2', 'c.mov'), '');
    fs.writeFileSync(path.join(root, 'note.txt'), '');
    fs.writeFileSync(path.join(root, '.hidden', 'd.mp4'), '');

    const res = scanVideoFiles(root);
    expect(res.files.map((f) => path.basename(f))).toEqual(['a.mp4', 'b.mkv', 'c.mov']);
    expect(res.folders).toBe(2);
    expect(res.truncated).toBe(false);
  });

  it('自然排序：clip2 在 clip10 之前', () => {
    const dir = makeTree();
    for (const n of [1, 2, 10, 11, 3]) fs.writeFileSync(path.join(dir, `clip${n}.mp4`), '');
    const res = scanVideoFiles(dir);
    expect(res.files.map((f) => path.basename(f))).toEqual([
      'clip1.mp4',
      'clip2.mp4',
      'clip3.mp4',
      'clip10.mp4',
      'clip11.mp4'
    ]);
  });

  it('达到数量上限时标记 truncated', () => {
    const dir = makeTree();
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(path.join(dir, 'nested', `v${i}.mp4`), '');
    }
    const res = scanVideoFiles(dir, { maxFiles: 2 });
    expect(res.files.length).toBe(2);
    expect(res.truncated).toBe(true);
  });

  it('expandPaths：文件夹展开 + 普通文件保留 + 去重', () => {
    const root = makeTree();
    fs.mkdirSync(path.join(root, 'sub1'), { recursive: true });
    const a = path.join(root, 'a.mp4');
    fs.writeFileSync(a, '');
    fs.writeFileSync(path.join(root, 'sub1', 'b.mkv'), '');

    const res = expandPaths([a, root]);
    expect(res.folders).toBe(1);
    expect(res.expandedFromFolders).toBe(2);
    expect(res.files.map((f) => path.basename(f)).sort()).toEqual(['a.mp4', 'b.mkv']);
  });

  it('expandPaths：不存在的路径原样保留（交给上层报错）', () => {
    const missing = path.join(makeTree(), 'does-not-exist.mp4');
    const res = expandPaths([missing]);
    expect(res.files).toEqual([missing]);
  });
});
