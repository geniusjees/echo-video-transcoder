import { BrowserWindow, nativeTheme } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG } from '@shared/constants';
import type { AppConfig, ExpertOptions, Preset } from '@shared/types';
import { setPreventSleepEnabled } from '../system/powerSave';
import {
  configPath,
  fallbackConfigPath,
  isWritable,
  appRoot,
  setConfiguredBins
} from '../utils/paths';

/**
 * 单一配置文件读写（C1/C2）
 * - 读取顺序：userData（若存在） → 应用根目录
 * - 写入：优先根目录；根目录不可写 → fallback userData 并通知 UI（§5.2）
 */

let current: AppConfig = structuredClone(DEFAULT_CONFIG);
let storageMode: 'root' | 'userData' = 'root';
let initialized = false;

function mergeDefaults(raw: Partial<AppConfig> | null | undefined): AppConfig {
  const base = structuredClone(DEFAULT_CONFIG);
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    paths: { ...base.paths, ...(raw.paths ?? {}) },
    transcode: { ...base.transcode, ...(raw.transcode ?? {}) },
    simpleMode: {
      ...base.simpleMode,
      ...(raw.simpleMode ?? {}),
      target: { ...base.simpleMode.target, ...(raw.simpleMode?.target ?? {}) }
    },
    expertDefaults: { ...base.expertDefaults, ...(raw.expertDefaults ?? {}) },
    presets: { ...base.presets, custom: raw.presets?.custom ?? base.presets.custom },
    hardware: { ...base.hardware, ...(raw.hardware ?? {}) },
    advanced: { ...base.advanced, ...(raw.advanced ?? {}) }
  };
}

function readJsonSafe(file: string): AppConfig | null {
  try {
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, 'utf-8');
    return mergeDefaults(JSON.parse(text));
  } catch (e) {
    console.error('[config] 读取失败：', file, e);
    return null;
  }
}

function chooseWriteTarget(): { file: string; mode: 'root' | 'userData'; reason?: string } {
  const root = configPath();
  const rootDir = appRoot();
  if (isWritable(rootDir)) return { file: root, mode: 'root' };
  return {
    file: fallbackConfigPath(),
    mode: 'userData',
    reason: `应用根目录不可写（${rootDir}），配置已改存到 ${fallbackConfigPath()}`
  };
}

export function initConfig(): { config: AppConfig; warning?: string } {
  const rootFile = configPath();
  const userFile = fallbackConfigPath();

  // 读取：优先 userData，其次根目录（便携版）
  const fromUser = readJsonSafe(userFile);
  const fromRoot = readJsonSafe(rootFile);
  current = fromUser ?? fromRoot ?? structuredClone(DEFAULT_CONFIG);

  // 首次启动：根目录生成 config.json（附录 A）
  let warning: string | undefined;
  if (!fromRoot && !fromUser) {
    const target = chooseWriteTarget();
    try {
      fs.mkdirSync(path.dirname(target.file), { recursive: true });
      fs.writeFileSync(target.file, JSON.stringify(current, null, 2), 'utf-8');
    } catch (e) {
      console.error('[config] 首次写入失败：', e);
    }
    storageMode = target.mode;
    warning = target.reason;
  } else {
    storageMode = fromUser && !fromRoot ? 'userData' : 'root';
    const target = chooseWriteTarget();
    if (target.mode === 'userData' && !fromUser) {
      warning = target.reason;
    }
    // 若根配置存在但目录只读，保证 userData 有一份可写副本
    if (target.mode === 'userData' && fromRoot && !fromUser) {
      try {
        fs.mkdirSync(path.dirname(userFile), { recursive: true });
        fs.writeFileSync(userFile, JSON.stringify(current, null, 2), 'utf-8');
        storageMode = 'userData';
        warning = target.reason;
      } catch {
        /* ignore */
      }
    }
  }

  initialized = true;
  applySideEffects();
  return { config: current, warning };
}

/** 应用配置产生的系统级副作用：主题、防休眠 */
function applySideEffects(): void {
  try {
    nativeTheme.themeSource = current.theme ?? 'system';
  } catch {
    /* ignore */
  }
  setPreventSleepEnabled(current.advanced?.preventSleep ?? true);
  // 让 ffmpeg/ffprobe 路径解析（含硬件侦测）能读到用户配置的绝对路径
  setConfiguredBins(current.paths ?? {});
}

export function getConfig(): AppConfig {
  if (!initialized) initConfig();
  return current;
}

export function getStorageMode(): 'root' | 'userData' {
  return storageMode;
}

export function saveConfig(next: AppConfig): { ok: boolean; warning?: string } {
  current = mergeDefaults(next);
  applySideEffects();
  const target = chooseWriteTarget();
  try {
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    fs.writeFileSync(target.file, JSON.stringify(current, null, 2), 'utf-8');
  } catch (e) {
    console.error('[config] 写入失败：', e);
    return { ok: false, warning: `配置写入失败：${String(e)}` };
  }
  storageMode = target.mode;
  notifyConfigChanged();
  return { ok: true, warning: target.reason };
}

export function patchConfig(patch: Partial<AppConfig>): { ok: boolean; warning?: string } {
  return saveConfig(mergeDefaults({ ...current, ...patch } as AppConfig));
}

function notifyConfigChanged(): void {
  const payload = { config: current, storageMode };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('config:changed', payload);
  }
}

// ---------------- 预设（C8） ----------------

export function listPresets(): Preset[] {
  return getConfig().presets.custom ?? [];
}

export function savePreset(name: string, options: ExpertOptions, id?: string): Preset {
  const cfg = getConfig();
  const presets = cfg.presets.custom ?? [];
  const existing = id ? presets.find((p) => p.id === id) : undefined;
  const preset: Preset = {
    id: existing?.id ?? `u-${Date.now().toString(36)}`,
    name: existing ? name || existing.name : name,
    options,
    createdAt: existing?.createdAt ?? new Date().toISOString()
  };
  cfg.presets.custom = existing
    ? presets.map((p) => (p.id === preset.id ? preset : p))
    : [...presets, preset];
  saveConfig(cfg);
  return preset;
}

export function deletePreset(id: string): void {
  const cfg = getConfig();
  cfg.presets.custom = (cfg.presets.custom ?? []).filter((p) => p.id !== id);
  saveConfig(cfg);
}

export function importPreset(file: string): Preset {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const preset = (Array.isArray(raw) ? raw[0] : raw) as Preset;
  if (!preset?.options) throw new Error('无效的预设文件');
  return savePreset(preset.name ?? '导入的预设', preset.options);
}

export function exportPreset(id: string, target: string): void {
  const preset = listPresets().find((p) => p.id === id);
  if (!preset) throw new Error('预设不存在');
  fs.writeFileSync(target, JSON.stringify(preset, null, 2), 'utf-8');
}
