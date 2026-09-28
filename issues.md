# 修复记录（Issue Log）

> 日期：2026-09-27
> 范围：输出文件夹默认值 / 硬件侦测 / 弹窗 i18n / 音频提取页列表
> 验证：`npx tsc --noEmit` 通过；`npx vitest run` → 9 个测试文件、55 个用例全部通过

---

## 汇总

| # | 问题 | 影响范围 | 根因类型 | 状态 |
|---|---|---|---|---|
| 1 | 输出文件夹没有平台默认值，跨平台残留绝对路径 | 主进程配置 | 缺省逻辑缺失 | ✅ 已修复 |
| 2 | Windows 右上角恒显示「软件编码」，即使已装 ffmpeg | 主进程硬件侦测 | 路径判断错误 | ✅ 已修复 |
| 3 | 编辑页输出完成的弹窗不跟随界面语言（界面英文仍弹中文） | 渲染进程 | 误用原生弹窗 | ✅ 已修复 |
| 4 | 提取音频完成后的提示不跟随界面语言（界面日语仍弹中文） | 渲染进程 | 闭包捕获首帧语言 | ✅ 已修复 |
| 5 | 音频提取页左侧列表显示的是转码信息，不是导出音频体积 | 渲染进程 | 列表未区分页面类型 | ✅ 已修复 |

---

## Issue 1 · 输出文件夹缺少平台默认值

**现象**
- 输出文件夹为空时，没有默认目录，用户必须手动选择。
- `config.json` 里硬编码了 macOS 路径 `/Users/kennychen/Downloads`，在 Windows 上会带出一个不存在的路径。
- 希望在本地设置后记住该目录，且默认值为 Mac「文档」/ Windows「文档」。

**根因**
- `DEFAULT_CONFIG.paths.outputDir` 为 `''`，且没有「按平台解析默认目录」的逻辑。
- 仓库内的 `config.json` 被提交了某台 Mac 的具体路径，跨平台复用即失效。

**修复**
- `src/main/config/configStore.ts`
  - 新增 `platformDefaultOutputDir()`：取 `app.getPath('documents')`。
  - 新增 `resolveOutputDir()`：已配置且**在本机真实存在** → 原样保留（用户本地设置优先，§6.2）；为空或路径在本机不存在（跨平台迁移遗留）→ 回退平台「文档」。
  - `initConfig()` 中解析默认值，并在值发生变化且配置文件已存在时**立即落盘**，下次启动直接复用。
- `config.json`：`paths.outputDir` 由 `/Users/kennychen/Downloads` 重置为 `""`，各平台自行解析。
- 用户主动修改路径时，原有 `setOutputDir` → `configSave` 链路继续负责持久化，无需改动。

**效果**
- macOS → `~/Documents`；Windows → `%USERPROFILE%\Documents`。
- 界面切到另一平台后不会再残留上一个平台的绝对路径。

---

## Issue 2 · Windows 右上角恒显示「软件编码」

**现象**
- 在 Windows 上打开，右上角硬件徽标显示「软件编码」，不显示 NVENC / QSV / AMF。
- 备注：排查时本机确实未安装 ffmpeg（`where ffmpeg` 无结果、仓库也无 `ffmpeg/`），此时显示软件编码是**正确**的；但代码里还有一个必现缺陷会让「已通过 winget/PATH 安装 ffmpeg」的用户同样恒降级。

**根因**
- `src/main/hardware/detector.ts` 的 `getEncoders()` 用 `fs.existsSync(bin)` 做前置判断。
- 而 `ffmpegPath()`（`src/main/utils/paths.ts`）在「未随包分发、依赖系统 PATH」时会回退成裸命令名 `ffmpeg`，此时 `fs.existsSync('ffmpeg')` 恒为 `false` → 直接返回空 → 硬件侦测全部为假 → 恒降级软件编码。
- macOS 因 `ffmpeg/bin/mac/ffmpeg` 是真实路径而正常，所以只在 Windows 暴露。

**修复**
- `src/main/hardware/detector.ts`：去掉 `fs.existsSync` 短路，直接执行，由 `run()` 的失败兜底；同时移除不再使用的 `node:fs` 导入。

```ts
async function getEncoders(): Promise<string> {
  const bin = ffmpegPath();
  if (!bin) return '';
  return run(bin, ['-hide_banner', '-encoders']);
}
```

**效果**
- 只要 `ffmpeg.exe` 在 PATH 上即可正确识别硬件编码器。

---

## Issue 3 · 编辑页完成弹窗不跟随界面语言

**现象**
- 编辑页输出完成后弹出提示，界面已设为英文，弹窗仍显示中文（标题栏 / 按钮）。

**根因**
- `EditPage` 使用 `window.alert()`。Electron 中 `window.alert` / `window.confirm` 是 **Chromium 原生对话框**，其标题与按钮文案由系统语言（`app.getLocale()`）渲染，不受应用内 i18n 设置控制。
- `App.tsx` 中清空队列用的 `window.confirm` 属同一类问题。

**修复**
- 新增 `src/renderer/stores/dialogStore.ts`：提供 Promise 风格的 `showAlert()` / `showConfirm()`，可在组件外调用。
- 新增 `src/renderer/components/MessageDialog.tsx`：标题 / 正文 / 按钮文案全部走 i18n，支持 Enter 确认、Esc 取消。
- `src/renderer/App.tsx`：挂载 `<MessageDialog />`；清空队列的 `window.confirm` 改用 `showConfirm()`。
- `src/renderer/pages/EditPage.tsx`：`window.alert(...)` → `void showAlert(t('edit.completed'))`。
- 10 份语言文件新增 `"dialog.ok"`（确定 / 確定 / OK / 확인 / Aceptar 等），取消按钮复用已有的 `op.cancel`。

---

## Issue 4 · 提取音频完成提示不跟随界面语言

**现象**
- 界面为日语，音频提取完成后弹出的「是否清空队列」确认框仍显示中文。

**根因**
- `App.tsx` 中订阅 `onTaskStatus` 的 `useEffect` 依赖为 `[onProgress, onLog, onStatus]`，只在挂载时执行**一次**。
- `useT()` 返回的是「闭包住本帧 locale」的函数（`src/renderer/i18n/index.ts`），而 i18n store 的 `locale` 初值为 `zh-CN`。语言切换后 effect 不会重新订阅，回调里用的仍是首帧的 `t` → 恒为中文。
- 音频提取结束会触发 `shouldPromptClearQueue()` → 弹确认框，因此该路径下必现。

**修复**
- `src/renderer/App.tsx`：事件订阅回调内改用 **i18n 模块级 `t`**（`import { t as translate }`），它在调用时读取当前语言：

```ts
void showConfirm(
  translate('queue.clearCompletedConfirm'),
  translate('queue.clear')
).then((confirmed) => { if (confirmed) useQueueStore.getState().clear(); });
```

**效果**
- 弹窗文案与语言切换实时一致；无需重新订阅 IPC 事件。

---

## Issue 5 · 音频提取页列表显示转码信息

**现象**
- 「提取音频」页左侧列表显示的是视频转码信息（`→ 1080p / 30fps / CRF … · libx265`、分辨率、帧率、码率等），与该页功能无关。
- 期望改为显示**预估的导出音频体积**。

**根因**
- `QueueList` 是通用组件，默认按「视频转码」渲染：来源行输出视频参数，第二行输出生效转码参数，右侧用 `estimateForItem()` 估算视频体积。
- 音频页复用了同一列表，但没有传任何「这是音频页」的信息。

**修复**
- `src/renderer/utils/estimate.ts`：新增 `AudioEstimateOptions` 与 `estimateAudioSize()`。
  - 有损（mp3 / aac / opus）：`码率 × 时长`
  - `wav`：`采样率 × 声道 × 16bit`
  - `flac`：`采样率 × 声道 × 16bit × 0.6`（无损经验系数）
  - 勾选「只提取时间段」时按片段实际时长计算，并裁剪到源时长内。
- `src/renderer/components/QueueList.tsx`：新增 `kind: 'video' | 'audio'`（默认 `video`）与 `audio` 参数。
  - `audio` 模式：图标 `🎵`；来源行改为音轨编码 · 采样率 · 声道 · 时长 · 大小 · 🔊/🔇；不渲染转码参数行与「无需转码」提示；右侧显示预估导出音频体积。
  - `video` 模式行为完全不变。
- `src/renderer/pages/ExtractAudioPage.tsx`：传入 `kind="audio"` 与当前表单参数（编码 / 码率 / 采样率 / 声道 / 片段范围），改参数即刷新预估。

---

## 变更文件清单

**新增**
- `src/renderer/stores/dialogStore.ts`
- `src/renderer/components/MessageDialog.tsx`

**修改**
- `config.json`
- `src/main/config/configStore.ts`
- `src/main/hardware/detector.ts`
- `src/renderer/App.tsx`
- `src/renderer/pages/EditPage.tsx`
- `src/renderer/pages/ExtractAudioPage.tsx`
- `src/renderer/components/QueueList.tsx`
- `src/renderer/utils/estimate.ts`
- `src/renderer/i18n/locales/*.json`（10 份，新增 `dialog.ok`）

---

## 遗留 / 待确认

- **`src/renderer/utils/format.ts` 存在硬编码中文**，日语等语言下会在转码页 / 专家模式露出：
  - `formatBitrate` → `'未知'`
  - `resolutionLabel` → `'未知'`
  - `codecLabel` → `'复制流'` / `'未知'`
  - `hwLabel` → `'软件编码'` / `'未侦测'`
  - 方案：改为走 i18n 并补齐 10 语言 key（**尚未实施，待确认**）。
- **Windows 缺失 ffmpeg 时没有可见提示**：`App.tsx` 的缺失组件提示框目前只在 `platform === 'darwin'` 时弹出，Windows 仅写日志。建议放开到全平台（**尚未实施，待确认**）。
- **主进程日志文案为中文**（如 `[环境] ⚠ 未找到必需组件…`）：属诊断信息，未纳入本次 i18n 修复范围。
