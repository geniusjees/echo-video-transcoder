# 修复记录（Issue Log）

> 最近更新：2026-10-02
> 验证方式：`npx tsc --noEmit` + `npx vitest run`（11 个测试文件 / 77 个用例）；关键项另做端到端验证，方式记在各自条目里。

## 汇总

| 日期 | # | 问题 | 影响范围 | 根因类型 | 状态 |
|---|---|---|---|---|---|
| 09-27 | 1 | 输出文件夹没有平台默认值，跨平台残留绝对路径 | 主进程配置 | 缺省逻辑缺失 | ✅ |
| 09-27 | 2 | Windows 右上角恒显示「软件编码」，即使已装 ffmpeg | 主进程硬件侦测 | 路径判断错误 | ✅ |
| 09-27 | 3 | 编辑页输出完成的弹窗不跟随界面语言（界面英文仍弹中文） | 渲染进程 | 误用原生弹窗 | ✅ |
| 09-27 | 4 | 提取音频完成后的提示不跟随界面语言（界面日语仍弹中文） | 渲染进程 | 闭包捕获首帧语言 | ✅ |
| 09-27 | 5 | 音频提取页左侧列表显示的是转码信息，不是导出音频体积 | 渲染进程 | 列表未区分页面类型 | ✅ |
| 09-28 | 6 | 打包版切换专家模式整个窗口白屏（`run dev` 正常） | 打包配置 | 语言包被误删 | ✅ |
| 09-28 | 7 | 专家模式 CRF 默认值应为 28 | 共享配置 | 默认值不符 | ✅ |
| 09-28 | 8 | 普通模式文案写「码率」，应为 CRF | i18n | 文案过期 | ✅ |
| 09-28 | 9 | 启动时把平台默认输出目录写回配置文件，把本机路径带进仓库 | 主进程配置 | 副作用（自己引入） | ✅ |
| 09-29 | 10 | 拼接运行中没有进度反馈（新增进度子窗体） | 渲染进程 | 功能缺失 | ✅ |
| 09-29 | 11 | 转码与拼接共用同一输出目录，互相覆盖；目录被删后开始即报错 | 主进程配置 / 任务 | 状态未隔离 | ✅ |
| 09-29 | 12 | 拼接裁剪面板显示在列表底部，而非当前片段下方 | 渲染进程 | UI 渲染位置 | ✅ |
| 09-29 | 13 | 输出文件夹可手动编辑，显示值与实际生效目录不一致 | 渲染进程 | 允许自由输入 | ✅ |
| 09-29 | 14 | NSIS 安装包不询问安装路径（一键安装） | 打包配置 | 使用了默认值 | ✅ |
| 09-30 | 15 | 普通模式按编码设置「不转码」阈值，默认 CRF 调整为 26 | 共享配置 / 决策树 | 阈值一刀切 | ✅ |
| 10-02 | 16 | 硬件编码器命令里不写画质参数（CRF 被完全丢弃） | 主进程命令构建 | 仅软件编码器写 `-crf` | ✅ |
| 10-02 | 17 | 输出体积预估严重偏大（与输出分辨率/编码无关） | 渲染进程 | 用「源码率 × 系数」估算 | ✅ |

---

# 2026-09-27

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
  - `initConfig()` 中解析默认值（**落盘策略见 Issue 9，已调整**）。
- `config.json`：`paths.outputDir` 由 `/Users/kennychen/Downloads` 重置为 `""`，各平台自行解析。
- 用户主动修改路径时，原有 `setOutputDir` → `configSave` 链路继续负责持久化。

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

**变更文件**
- 新增：`src/renderer/stores/dialogStore.ts`、`src/renderer/components/MessageDialog.tsx`
- 修改：`config.json`、`src/main/config/configStore.ts`、`src/main/hardware/detector.ts`、`src/renderer/App.tsx`、`src/renderer/pages/EditPage.tsx`、`src/renderer/pages/ExtractAudioPage.tsx`、`src/renderer/components/QueueList.tsx`、`src/renderer/utils/estimate.ts`、`src/renderer/i18n/locales/*.json`（10 份，新增 `dialog.ok`）

---

# 2026-09-28

## Issue 6 · 打包版切换专家模式整个窗口白屏

**现象**
- `npm run dist` 出来的 Windows 应用，在转码页切到「专家模式」后整个窗口白屏；切到「提取音频」页同样白屏。
- `npm run dev` 完全正常。
- 日志里没有任何 JS 报错，`debug.log` 只有 `locale resources are not loaded`。

**根因**
- `package.json` 的 `build.win.electronLanguages` / `build.mac.electronLanguages` 用了**下划线**命名：
  `["de","en","en_GB","es","fr","it","ja","ko","pt_BR","pt_PT","zh_CN","zh_TW"]`
- Electron 的 locale 文件名是**短横线**：`en-US.pak` / `en-GB.pak` / `zh-CN.pak` / `zh-TW.pak` / `pt-BR.pak` / `pt-PT.pak`。electron-builder 按文件名精确匹配，于是只有 `de es fr it ja ko` 命中。
- 实测打包后 `locales/` 只剩 **6 个** pak（开发态有 55 个）。中文系统 `app.getLocale()` = `zh-CN` → Chromium 取不到语言资源，渲染表单控件（`<select>` / `<input type="number">`）时 CHECK 失败 → **渲染进程直接崩溃**（进程级崩溃，不是 JS 异常），窗口白屏。
- 之所以看着像「专家模式」的问题：专家面板和音频页是表单控件最密集的两个页面，编辑/旋转页大多是按钮所以不崩。

**定位方式**
- 把 `playwright-core` 装在临时目录（不进项目依赖），用 CDP 连接真实的 `release/win-unpacked/Echo Video Transcoder.exe`，点击后拿到 `Target crashed`；对「提取音频」做同样操作也必崩 → 证明不是专家模式特有。

**修复**
- 删除 `win` / `mac` 的 `electronLanguages`，全部语言包随包分发（55 个 pak，约 2–3 MB；相对 ffmpeg 的 330 MB 可忽略）。
- **不能**只把名字改成短横线：Chromium 的 UI locale 取的是**操作系统语言**，不是软件界面语言，任何不在白名单里的系统语言（俄语、荷兰语、泰语…）都会踩同一个白屏。

**验证**
- 删掉 `locales/` 后重新 `electron-builder --dir` → 自动生成 55 个 pak，含 `zh-CN.pak` / `en-US.pak`。
- 重新打包的 exe 用同一套自动点击跑「旋转 / 编辑 / 提取音频 / 转码 / 专家模式」全部正常（修复前「提取音频」与「专家模式」必崩）。

---

## Issue 7 · 专家模式 CRF 默认值改为 28

| 文件 | 改动 |
|---|---|
| `src/shared/constants.ts` | `DEFAULT_CONFIG.expertDefaults.crf`：`23` → `28` |
| `src/renderer/stores/configStore.ts` | `expertOptionsFromConfig`：`crf: d?.crf ?? 23` → `?? 28` |
| `src/renderer/components/mode/ExpertMode.tsx` | CRF 输入框兜底值：`options.crf ?? 23` → `?? 28` |

**注意**：已有配置文件的用户不会被覆盖——`mergeDefaults` 只在字段缺失时才用默认值，老配置里已存的 `crf: 23` 会保留。

---

## Issue 8 · 普通模式文案「码率」改为 CRF

**根因**：简单模式早已从 VBR 6Mbps 改为统一 CRF 28，但只有 `en.json` 更新过文案，其余 9 种语言仍写着 `{{b}}Mbps` / 「码率自动」。

**修复**：9 种语言（zh-CN / zh-TW / ja / ko / de / it / fr / es / pt）的 `scale.onCurrent` / `scale.offCurrent` / `scale.tipOn` / `scale.tipOff` 统一改为 `CRF {{c}}`（`{{c}}` = 28）。

- 「当前：缩放到 1080p / 30fps / **CRF 28**」
- 「当前：保持源分辨率 / 30fps / **CRF 28**」
- 顺带修掉 `tipOff` 里过期的「码率按像素比自动计算并被源码率封顶」描述。

**验证**：脚本扫描 10 份 locale，确认这几个 key 都含 `CRF {{c}}`、且无残留 `{{b}}`/`Mbps`/`码率`/`bitrate`。

---

## Issue 9 · 启动时把平台默认输出目录写回配置文件

**现象**（Issue 1 的副作用，由本次排查发现）
- 开发态 `appRoot()` 就是仓库根目录，于是**一次 `npm run dev` 就会把本机绝对路径写进被跟踪的 `config.json`**（`outputDir` 被写成 `d:\Users\Jees\Documents`），并已带入提交。

**根因**
- `initConfig()` 解析出平台默认输出目录后**立即落盘**。但该默认值完全由平台推导得出，落盘只会把「某台机器的路径」带进仓库。

**修复**
- `src/main/config/configStore.ts`：去掉「解析后立即落盘」，改为**只在内存生效**；用户主动选择目录时仍走 `saveConfig` 正常持久化。

**验证**
- 把 `tmp/config.json` 的 `outputDir` 置空 → 启动应用 →
  - 界面上的输出文件夹 = `d:\Users\Jees\Documents`（默认值仍生效）
  - 文件内容仍是 `"outputDir":""`（不再被写回）

**顺带**：`.vscode/launch.json` 精简为 `Electron: 开发 (npm run dev)` + `Electron: 打包 (npm run dist)` 两条。

---

# 2026-09-29

## Issue 10 · 拼接新增运行中进度子窗体

**需求**
- 拼接运行时弹出子窗体显示进度条；完成后子窗体提示「拼接完成」。

**实现**
- `src/renderer/stores/concatStore.ts`：新增 `taskId` / `status('idle'|'running'|'done'|'error')` / `error` / `output`，以及 `applyTaskStatus()`（按 taskId 精确匹配并复位 `busy`）和 `closeProgress()`；`start()` 生成任务 id 后打开子窗体。
- 新增 `src/renderer/components/concat/ConcatProgressDialog.tsx`（portal 到 body 的模态子窗体）：
  - 运行中 → `⏳ 拼接进度`：文件名 + 进度条 + 百分比 + 输出路径 + 策略说明；按钮「取消」
  - 完成 → `✅ 拼接完成`：100% 进度条 + 完整输出路径；按钮「打开」「关闭」
  - 失败 → `⚠ 拼接失败`：ffmpeg 错误原因；按钮「关闭」
  - 进度直接订阅主进程 `progress` 事件（id 与拼接任务一致），`runConcat` 已把「多片段转码对齐」的分步进度归一化到 0–99.5%
- `src/renderer/App.tsx`：挂载组件；把原来只复位 `busy` 的那段换成 `useConcatStore.getState().applyTaskStatus(p)`。
- i18n：新增 `concat.progressTitle` / `concat.progressDone` / `concat.progressFailed`，10 种语言齐全。

**验证**（真实流程：两段不同分辨率素材 → 加入队列 → 开始拼接）
```
[4] 运行中(子窗体) => {"dialog":"拼接进度","pct":"0.0%","hasBar":true}
[poll 0] 拼接完成 @ 100.0%
[5] ✅ 拼接完成 | merged.mp4 | 100.0% | E:\...\tmp\out/merged.mp4 | 打开 | 关闭
```
且 `tmp/out/merged.mp4` 实际产出。

---

## Issue 11 · 转码与拼接共用同一输出目录

**现象**
- 转码点击开始后报错；拼接页改动输出目录会覆盖转码页（反之亦然）；那个目录被删除后，转码开始写入时直接失败。

**根因**
- 两边共用同一个 `paths.outputDir`：拼接页选目录调用 `setOutputDir`（写共享字段），`App.tsx` 又用该字段初始化拼接页目录。目录被删掉后，ffmpeg 不会自建目录 → 一开始就报错。

**修复**
| 文件 | 改动 |
|---|---|
| `src/shared/types.ts` | `PathsConfig` 新增 `concatOutputDir` |
| `src/shared/constants.ts` | `DEFAULT_CONFIG.paths.concatOutputDir = ''`（老配置由 `mergeDefaults` 补齐，无需迁移） |
| `src/main/config/configStore.ts` | 两个目录字段**各自独立**解析平台默认值（仍只在内存生效） |
| `src/renderer/stores/configStore.ts` | 新增 `setConcatOutputDir()` |
| `src/renderer/pages/ConcatPage.tsx` | 改目录只写 `concatOutputDir`，不再碰 `paths.outputDir` |
| `src/renderer/App.tsx` | 用 `config.paths.concatOutputDir` 初始化拼接目录 |
| `src/renderer/stores/concatStore.ts` | 取 `paths.concatOutputDir` |
| `src/main/transcoder/taskRunner.ts` | 新增 `ensureOutputDir()`：跑 ffmpeg / 拼接前 `mkdir -p` 输出目录 |

转码侧（转码 / 旋转 / 编辑 / 提取音频 + 队列入队）继续用 `paths.outputDir`，行为不变。

**验证**（隔离配置，改掉拼接目录后回转码页）
```
[转码页 输出目录]           => E:\...\tmp\out
[拼接页 输出目录]           => d:\Users\Jees\Documents   ← 独立默认值
[转码页 输出目录(改拼接后)] => E:\...\tmp\out            ← 没被带跑
```

---

## Issue 12 · 拼接裁剪面板显示在列表底部

**根因**：`SegmentList` 把 `<SegmentTrim>` 渲染在 `segments.map()` **之后**，所以面板永远贴在整份列表底部。

**修复**：每个片段与它的裁剪面板包成一组，面板只在被裁剪的片段正下方渲染。

```tsx
{editing === seg.id && (
  <SegmentTrim
    segment={seg}
    onChange={(trim) => onTrimChange(seg.id, trim)}
    onClose={() => setEditing(null)}
  />
)}
```

**验证**
```
rows = ["0 → nextIsTrimPanel=false", "1 → nextIsTrimPanel=true"]
listLastChildIsTrim = false
```
即只有被裁剪的第 2 个片段下方有面板，列表底部不再有游离面板。

---

## Issue 13 · 输出文件夹取消手动编辑

**现象**
- 输出文件夹输入框可编辑，敲进去的任意字符串都会被当成输出目录存进配置并用于生成输出路径（半截路径 / 相对路径 / 不存在的路径都照样生效），于是「显示的值」和「实际生效目录」对不上。

**修复**：`src/renderer/components/OutputFolderPicker.tsx`
- 输入框改为 `readOnly`，去掉 `onChange`：只能通过「浏览」按钮选目录，保证显示值 == 实际生效目录。
- 光标改为 `cursor-default`，并加 `title` 提示；路径仍可选中复制，只是不能改。
- 新增 i18n key `out.readonlyHint`，10 种语言齐全（例：`路径不可手动输入，请用「浏览...」选择文件夹`）。
- 「浏览」「打开」按钮行为不变（浏览仍带当前目录作为 `defaultPath`）。
- 这是共用组件，**转码 / 编辑 / 旋转 / 提取音频 / 拼接** 五个页面一并生效。

**验证**（CDP 真实键盘事件）
```
{"readOnly":true,
 "before":"E:\\...\\tmp\\out",
 "afterType":"E:\\...\\tmp\\out",     ← 点击后输入 D:\bogus-dir 无效
 "afterReplace":"E:\\...\\tmp\\out",  ← Ctrl+A 全选后输入新路径也无效
 "unchanged":true}
```
磁盘上的 `config.json` 也未被改写。

---

## Issue 14 · NSIS 安装包不询问安装路径

**现象**
- 双击 `Echo Video Transcoder Setup 0.1.0.exe` 后直接装完，全程没有「选择安装位置」这一步。

**根因**
- 不是漏配置，而是 electron-builder 的 NSIS 默认值。核对本项目安装的 electron-builder（24.13.3）自带 schema：

| 选项 | 默认值 |
|---|---|
| `oneClick` | `true` |
| `allowToChangeInstallationDirectory` | `false` |
| `perMachine` | `false` |

- `oneClick: true` 即「一键安装」：装到固定的用户目录、不问路径、也没有目录选择页。项目里原本没有 `build.nsis` 段，因此全部走默认值。

**修复**
- `package.json` 新增 `build.nsis`：

```json
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true
    },
```

- `oneClick: false` → 向导式安装（欢迎页 → 选择安装目录 → 安装 → 完成）
- `allowToChangeInstallationDirectory: true` → 显示「选择安装位置」页
- `perMachine: false` → 当前用户安装，装到 `%LOCALAPPDATA%\Programs\Echo Video Transcoder`，不弹 UAC

**约束（重要）**
- 这两个选项必须成对使用。`node_modules/app-builder-lib` 里有硬断言：

```js
if (options.allowToChangeInstallationDirectory) {
  throw new InvalidConfigurationError("allowToChangeInstallationDirectory makes sense only for assisted installer (please set oneClick to false)");
}
```

- 只加 `allowToChangeInstallationDirectory` 而不关掉 `oneClick` → 构建直接失败。
- 若想装到 `C:\Program Files`（所有用户）：改 `perMachine: true`，会有 UAC 提示；而且安装目录不可写，应用的 `config.json` 会自动回退到 `%APPDATA%\Echo Video Transcoder\`（§5.2 已有兜底），设置仍能保存。

**验证**
- 单独构建 NSIS 目标 `npx electron-builder --win nsis` → 成功，日志确认已是辅助式安装器：

```
• building target=nsis file=release\Echo Video Transcoder Setup 0.1.0.exe archs=x64 oneClick=false perMachine=false
```

- 产物已更新：`release\Echo Video Transcoder Setup 0.1.0.exe`（162.8 MB，2026-09-29 21:14）。
- `portable` target 不受该配置影响；本次只重建了安装版，正式出包仍建议跑一次 `npm run dist` 把移动版一并刷新。

**变更文件**
- 新增：`src/renderer/components/concat/ConcatProgressDialog.tsx`
- 修改：`package.json`、`config.json`、`src/shared/types.ts`、`src/shared/constants.ts`、`src/main/config/configStore.ts`、`src/main/transcoder/taskRunner.ts`、`src/renderer/App.tsx`、`src/renderer/pages/ConcatPage.tsx`、`src/renderer/components/OutputFolderPicker.tsx`、`src/renderer/components/concat/SegmentList.tsx`、`src/renderer/stores/concatStore.ts`、`src/renderer/stores/configStore.ts`、`src/renderer/i18n/locales/*.json`（10 份，新增 `concat.progress*`、`out.readonlyHint`）

---

# 2026-09-30

## Issue 15 · 普通模式按编码设置「不转码」阈值，默认 CRF 调整为 26

**背景 / 需求**
- 原普通模式用固定的 `bitrateMbps = 6` + `crf = 28` 单一阈值，对所有编码一刀切，无法反映不同编码的效率差异。
- 需要按编码格式分别设置「不转码」检测阈值，并把普通模式与专家模式的默认 CRF 调整为 **26**。
- 后续补充需求：**不允许为了统一格式而在现代编码之间强制转码**（多次转码损失画质），仅对旧格式做兜底转码。

**阈值 / CRF 对照（视频流码率）**

| 目标编码 | CRF | 720p30 | 1080p30 | 1440p30 | 4K30 |
|---|---|---|---|---|---|
| H.264 | 21 | 2.7 | 6.0 | 10.7 | 24.0 |
| H.265 | 26 | 1.8 | 4.0 | 7.1 | 16.0 |
| VP9 | 30 | 1.8 | 4.0 | 7.1 | 16.0 |
| AV1 | 33 | 1.2 | 2.8 | 5.0 | 11.2 |

- 阈值 = `NOOP_RATE_BASE[目标编码] × (源像素 / 1080p 像素)`（4K = ×4）；CRF = `TARGET_CRF[目标编码]`。
- 判定：`needTranscode = 分辨率超标 || 码率超阈值 || 帧率超标 || 旧格式(legacy/未知)`。
  - **现代编码之间**（h264 / hevc / vp9 / av1）不因格式不同而转码，避免重复转码损失画质；
  - **旧格式**（Xvid/`mpeg4`、`mpeg2video`、`vc1`、`wmv3`、`vp8`、`h263` 等）或探测不到编码的源，一律兜底转码为现代编码。
- `simpleMode.target.bitrateMbps` / `crf` 保留为**可选手动覆盖**，留空则按目标编码查表。

**变更文件**

| 文件 | 改动 |
|---|---|
| `src/shared/constants.ts` | 新增 `TARGET_CRF`、`NOOP_RATE_BASE`、`normalizeCodec()`、`isLegacyCodec()`、`CodecKind`；`TARGET.crf` 28→26；`DEFAULT_CONFIG.expertDefaults.crf` 28→26；`DEFAULT_CONFIG.simpleMode.target` 移除写死的 `bitrateMbps`/`crf` |
| `src/shared/types.ts` | `SimpleModeConfig.target` 的 `bitrateMbps`/`crf` 改为可选覆盖；`Target.crf` 注释更新 |
| `src/main/transcoder/simpleDecision.ts` | 阈值 / CRF 按目标编码查表 + 分辨率缩放；新增 `needByLegacy` 兜底 |
| `src/main/concat/concatPlanner.ts` | `PlanOptions.target` 放宽为可选字段 + 基准码率兜底 |
| `src/renderer/stores/configStore.ts`、`src/renderer/pages/TranscodePage.tsx`、`src/renderer/components/mode/SimpleMode.tsx`、`src/renderer/components/mode/ExpertMode.tsx`、`src/renderer/components/ScaleResolutionSwitch.tsx` | CRF 兜底值 28→26，适配可选 `bitrateMbps` |
| `config.json` | 同步（移除 `target.bitrateMbps`/`crf`，`expertDefaults.crf` → 26） |
| `tests/simpleDecision.test.ts` | 按新逻辑重写为 16 条用例（按编码阈值 / 分辨率缩放 / legacy 兜底 / 现代编码不互转） |

**行为变化**
- 阈值随分辨率缩放：720p ≈ ×0.44、1440p ≈ ×1.78、4K = ×4。
- 源编码与目标编码同为现代编码且规格达标 → `no-op`（不重编码）；旧格式 / 无法识别 → 转码。
- 简单模式默认 CRF 现为 26（H.265 基准），专家模式默认 CRF 也改为 26。

**验证**
- `npx tsc --noEmit` 无错误；`npx vitest run` 9 个测试文件 / 58 个用例全部通过。

---

# 2026-10-02

## Issue 16 · 硬件编码器命令里不写画质参数（CRF 被丢弃）

**现象**
- 普通模式使用硬件编码（示例机器为 NVENC）时，生成的命令里没有画质参数。实际命令片段：
```
… -map 0:v:0 -map 0:a:0? -sn -dn -c:v hevc_nvenc -c:a aac -b:a 192k -ar 48000 -ac 2 …
```
- `-c:v hevc_nvenc` 后面既没有 `-crf` 也没有 `-b:v`，设定的 CRF 26 完全没生效。

**根因**
- `commandBuilder.ts` 只在**软件编码器**分支写 `-crf`：

```ts
if (typeof params.crf === 'number' && isSoftwareEncoder(encoder)) {
  args.push('-crf', String(params.crf), '-preset', 'medium');
} else if (params.bitrateMbps > 0) { /* -b:v / -maxrate / -bufsize */ }
```

- 硬件编码器不满足 `isSoftwareEncoder`（只匹配 `libx264/libx265/libvpx/libsvtav1…`）；而普通模式走 CRF 模式，`bitrateMbps = 0`，第二个分支也不成立 → **两个分支都不命中**，硬件编码器退回自身默认码控。
- `-crf` 本身是 `libx264/libx265` 的私有选项，NVIDIA / Intel / AMD / Apple 的硬件编码器都不认，必须换成各自参数。

**修复**
- 新增 `encodeQualityArgs(encoder, params)`，先由 `encoderKind()` 判定厂商（`_nvenc` / `_qsv` / `_amf` / `_vaapi` / `_videotoolbox` / 软件），再生成对应质量参数：

| 编码器 | CRF 模式（普通模式 / 专家模式 crf） | 码率模式（专家模式 cbr/vbr） |
|---|---|---|
| 软件 `libx264` / `libx265` | `-crf N -preset medium` | `-b:v N -maxrate N -bufsize 2N` |
| `*_nvenc` | `-rc vbr -cq N -b:v 0` | `-rc vbr -b:v N -maxrate N -bufsize 2N` |
| `*_qsv` | `-global_quality N`（ICQ，1–51） | `-b:v N -maxrate N -bufsize 2N` |
| `*_amf` | `-rc cqp -qp_i N -qp_p N` | `-rc vbr_peak -b:v N …` |
| `*_vaapi` | `-rc_mode CQP -qp N` | `-rc_mode VBR -b:v N …` |
| `*_videotoolbox` | `-q:v <100 − CRF×1.6>`（0–100，越大越好） | `-b:v N -maxrate N -bufsize 2N` |

- 普通模式与专家模式**共用**该函数；`buildRotateArgs` 里原先对硬件编码器硬编码的 `-b:v 0 -q:v 60`（对 NVENC 无效）也一并改为同一映射（CRF 20 基准）。
- 修复后同一输入生成的命令变为：`… -c:v hevc_nvenc -rc vbr -cq 26 -b:v 0 …`。

**变更文件**
- `src/main/transcoder/commandBuilder.ts`
- 新增 `tests/commandBuilder.test.ts`（9 用例，逐一断言各厂商 CRF / 码率模式参数）

**验证**
- `npx tsc --noEmit` 无错误；`npx vitest run` 全部通过。

---

## Issue 17 · 输出体积预估严重偏大

**现象**
- 预估输出体积明显偏大：一个 5 分钟 1080p、CRF 25 的视频预估约 **900MB**（实际应在 1–2 百 MB 量级）。

**根因**
- `src/renderer/utils/estimate.ts` 在 CRF 模式下用「**源码率 × 经验系数**」估算，既不含**输出分辨率**、也不含编码差异：

```ts
videoKbps = (source.bitrateMbps ?? 6) * 1000 * crfFactor(params.crf);
```

- 于是源码率越高（源越清晰），预估越离谱；缩放到 1080p 输出也不会降低预估。

**修复**
- 改为按「**输出分辨率 + 编码基准码率 + CRF**」推算等效视频码率，再叠加音频码率 × 时长，并封顶到源码率（C6）：

```
视频码率 = NOOP_RATE_BASE[编码] × (输出像素 / 1080p) × 2^((基准CRF − CRF)/6)   // CRF 模式
         = params.bitrateMbps                                                   // 码率模式
体积 = (视频码率 + 音频码率) / 8 × 时长 × 容器开销，且视频码率 ≤ 源码率
```

- 输出像素由**输出高度** + 源宽高比推出：缩放到 1080p 按 1080p 估，保持 4K 则 ×4。
- 悬停说明改为展示推算值（如 `码率 CRF 26 ≈ 4.0 Mbps`）。

**效果**（1080p / 5min / 192k 音频）

| 情况 | 旧预估 | 新预估 |
|---|---|---|
| H.265 CRF 25 | 随源码率膨胀（可达数百 MB） | ≈ 179 MB |
| H.264 CRF 25 | 同上 | ≈ 152 MB |
| H.265 CRF 26 | — | ≈ 160 MB |

**变更文件**
- `src/renderer/utils/estimate.ts`
- 新增 `tests/estimate.test.ts`（10 用例）

**验证**
- `npx tsc --noEmit` 无错误；`npx vitest run` 11 文件 / 77 用例全部通过；`npm run build` 成功。

---

## 遗留 / 待确认

- **`src/renderer/utils/format.ts` 存在硬编码中文**，日语等语言下会在转码页 / 专家模式露出：
  - `formatBitrate` → `'未知'`
  - `resolutionLabel` → `'未知'`
  - `codecLabel` → `'复制流'` / `'未知'`
  - `hwLabel` → `'软件编码'` / `'未侦测'`
  - 方案：改为走 i18n 并补齐 10 语言 key（**尚未实施，待确认**）。
- **Windows 缺失 ffmpeg 时没有可见提示**：`App.tsx` 的缺失组件提示框目前只在 `platform === 'darwin'` 时弹出，Windows 仅写日志。建议放开到全平台（**尚未实施，待确认**）。
- **移动版（portable）设置不持久**：便携版每次启动解压到新的随机临时目录，`appRoot()` 指向那里，`config.json` 写在临时目录里（实测 `%LOCALAPPDATA%\Temp\<随机>\config.json`，`%APPDATA%` 下从未生成）→ 语言 / 输出目录 / 预设每次重置。方案：优先使用 electron-builder 为 portable 注入的 `PORTABLE_EXECUTABLE_DIR`（**尚未实施，待确认**）。
- **转码队列与编辑 / 旋转 / 提取音频共用**（同一个 `useQueueStore.items`，拼接页是独立 store）：在其它页签加过、后来文件被删除，切回转码页点「开始」仍会尝试转码并报错。是否加一道「开始前跳过已不存在的输入文件并在日志/提示里说明」的守卫（**待确认**）。
- **主进程日志文案为中文**（如 `[环境] ⚠ 未找到必需组件…`）：属诊断信息，未纳入 i18n 修复范围。
- **待提交**：`config.json` 的 `outputDir` 改回 `""`（HEAD 里当前是本机路径）以及本轮新增的 `concatOutputDir` 等改动仍在工作区。
