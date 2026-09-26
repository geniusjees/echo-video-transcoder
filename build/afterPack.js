'use strict';

/**
 * electron-builder `afterPack` 钩子（在 macOS 代码签名之前执行，见 macPackager.js:125）。
 *
 * 背景：`electronLanguages` 选项在 macOS 上只会清理
 * `<app>/Contents/Resources/*.lproj`，而这些是 64 字节的空占位目录（实测 0KB）。
 * Electron 真正的语言包位于
 * `<app>/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/<lang>.lproj/locale.pak`，
 * 每个约 450KB × 55 个 ≈ 37MB，不受该选项影响。
 *
 * 这里直接裁剪 Framework 内的语言包，只保留应用 i18n 实际支持的语言
 * （见 src/renderer/i18n/locales）。语言包缺失时 Chromium 会回退到 en，
 * 因此 en 必须保留。
 */

const fs = require('node:fs');
const path = require('node:path');

/** 与应用 i18n 支持的语言保持一致；en 为回退语言，必须保留 */
const KEEP = new Set([
  'en',
  'en_GB',
  'zh_CN',
  'zh_TW',
  'ja',
  'ko',
  'de',
  'es',
  'fr',
  'it',
  'pt_BR',
  'pt_PT'
]);

function dirSize(p) {
  let total = 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const child = path.join(p, entry.name);
    total += entry.isDirectory() ? dirSize(child) : fs.statSync(child).size;
  }
  return total;
}

async function afterPack(context) {
  // Windows / Linux 的 locale.pak 由 electronLanguages 选项正常处理
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const dir = path.join(
    context.appOutDir,
    `${appName}.app`,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources'
  );

  if (!fs.existsSync(dir)) {
    console.warn(`[afterPack] 未找到 Electron Framework Resources，跳过：${dir}`);
    return;
  }

  let removed = 0;
  let freed = 0;

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.lproj')) continue;

    const lang = entry.slice(0, -'.lproj'.length);
    if (KEEP.has(lang)) continue;

    const target = path.join(dir, entry);
    freed += dirSize(target);
    fs.rmSync(target, { recursive: true, force: true });
    removed += 1;
  }

  console.log(
    `[afterPack] 已裁剪 ${removed} 个未使用的语言包（保留 ${KEEP.size} 个），` +
      `释放约 ${(freed / 1024 / 1024).toFixed(1)} MB`
  );
}

module.exports = afterPack;
// electron-builder 同时兼容 default 导出形式
module.exports.default = afterPack;
