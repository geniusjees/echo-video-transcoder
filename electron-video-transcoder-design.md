# 视频转码工具 · 详细设计文档（Electron + React + TypeScript）

> **项目名称**：Echo Video Transcoder（包名 `echo-video-transcoder`，应用名随语言切换）  
> **技术栈**：Electron（主进程 Node.js）+ React + TypeScript（渲染进程）  
> **目标平台**：Windows 10/11（NSIS）、macOS 11+（Apple Silicon & Intel，dmg）  
> **文档版本**：v5.0（按实际代码对齐：移除未实现的「下载」与独立「压缩」页签，补齐多语言 i18n、更正 IPC 契约与目录结构）  
> **变更记录**：  
> v1 Tauri → v2 Electron+React+TS → v3 简单模式单一配置 → v4 视频拼接 + 综合判断(B) → v4.1 拼接音频统一 + 无转场  
> v5.0 **①按真实代码校正**：移除「网页下载(yt-dlp)」与独立「压缩」页（均**未实现**，压缩能力并入转码决策树 / 专家模式 CRF）②补齐**多语言 i18n（10 种语言 + 系统语言自动匹配 + 回退英语）**③更正 IPC 通道、目录结构、`extraResources` 路径、配置 Schema 与共享类型

---

## 一、项目概述

一款跨 Windows + macOS 的桌面端视频处理工具，以 **FFmpeg** 为底层引擎，通过 Electron 提供现代化 UI。把专业、难记的 FFmpeg 命令封装成"拖拽即可用、参数可视化、**默认显卡加速**、**绝不劣化源片**"的桌面工具。

### 1.1 核心功能
> ⚠️ **实际实现范围（v5.0）**：当前产品仅含 **4 个页签**——`转码 / 旋转 / 提取音频 / 拼接`。
> 设计稿中的「网页视频下载(yt-dlp)」与独立「压缩」页签**尚未实现**（见 §1.1.1），压缩能力已并入转码决策树与专家模式。

1. **视频转码**：格式/编码/分辨率/帧率/码率可调，**默认显卡加速**；含**压缩**：简单模式按统一码率压制、专家模式按 CRF/CBR 控制体积（§7、§8）
2. **视频旋转/翻转**：0°/90°/180°/270°、水平/垂直翻转，**优先元数据旋转（不重编码）**，翻转无法用元数据时自动回退重编码
3. **音频提取**：视频抽音轨 → aac/mp3/wav/flac/opus，可选起止时段
4. **🎬 视频拼接**：把多个视频**按顺序首尾相连**合成一个文件，支持：
   - **纯拼接**：所有片段参数一致时**不重编码**（stream copy，`-c copy`），秒级完成
   - **统一转码拼接**：参数不一致时，先各自按**统一配置（§7）**转码对齐，再拼接
   - **音频统一规则（v4.1，A 方案，强制）**：转码对齐阶段——
     - 无声/纯画面片段 → **补静音音轨**（`-f lavfi -i anullsrc`）使其时长与其他片段一致
     - 所有片段采样率 → **统一 48kHz**（`-ar 48000`），声道统一立体声
     - 保证拼接后**音画时长严格对齐、绝不报错**
   - **关于转场（v4.1 简化）**：**纯拼接不加转场**（硬切直连，保证 -c copy 高速路径）；
     转场（淡入淡出/xfade 等）**不在 MVP 基础流程内**（见 §10.6 备注）
   - 片段管理：拖拽排序、裁剪首尾、预览缩略图
   - 输出：单文件，沿用简单模式配置（1080p/30fps/6Mbps/H.265）或专家模式参数

#### 1.1.1 设计稿中**尚未实现**的功能（v5.0 现状）
| 功能 | 设计稿描述 | 实际状态 |
|---|---|---|
| 网页视频下载 (yt-dlp) | URL→下载→转码一体化、DownloadPage、M4 里程碑 | ❌ 未实现：`src/main/download/` 为空，无 `DownloadPage`，无对应页签；`config.json` 仍保留 `download` 段但**代码不使用**（不在 `AppConfig` 类型中） |
| 独立「压缩」页签 | 核心功能 #2、独立 Tab、CompressPage | ❌ 未实现：压缩能力融合进**转码**（简单模式统一码率压制 + 专家模式 CRF/CBR），无独立页面 |

### 1.2 两种转码模式（核心）
- **🟢 普通（简单）模式**：**一种统一配置**，系统自动决策是否转码、是否缩放、码率多少（§7 决策树）。**用户只需拖入视频、指定输出文件夹、点开始。**
- **🔵 专家模式**：自由配置所有参数，可保存自定义预设（§8）

### 1.3 设计目标 / 硬约束
- **零命令行**、**默认快**（默认硬件加速，含 Apple MPS）、**绝不劣化**（任何模式不提升分辨率/码率）
- **拖拽入队**：拖拽视频文件到窗口即可加入转码队列（§13.1）
- **输出文件夹必选**：普通模式必须由用户指定输出文件夹才可开始（§6.2）
- **普通模式默认质量**：从 VBR 6Mbps 调整为 CRF 28，统一压制质量更稳定，输出参数展示也使用 CRF 28（§7）

---

## 二、硬性约束（开发必须遵守）

| # | 约束 | 说明 |
|---|---|---|
| C1 | **单一配置文件** | 整个软件**只用一个** `config.json`，不拆分 |
| C2 | **配置在软件根目录** | `config.json` 放在**应用根目录**（与主进程可执行文件同级），便于手动编辑 |
| C3 | **简单模式默认 H.265** | 简单模式统一配置视频编码 = **HEVC (H.265)** |
| C4 | **自动侦测显卡（含 Apple MPS）** | 启动时自动探测，macOS 识别 **Apple M 系列 GPU (MPS) → VideoToolbox** |
| C5 | **FFmpeg 在软件根目录** | `ffmpeg` 随应用分发，**不要求用户安装** |
| C6 | **不提升分辨率/码率** | 任何模式下输出分辨率、码率**绝不高于源文件**；**综合判断(B)**：分辨率低于 1080p 但码率高于 6Mbps 时仍按统一配置重编码（保留分辨率、按 CRF 28 质量压制，不提升分辨率）（§7.1） |
| C7 | **参数对用户可见** | 所有生效参数（含自动计算/封顶后的真实值）展示给用户确认 |
| C8 | **配置可保存/复用** | 专家模式自定义预设可保存、导入、导出 |
| **C9** | **拖拽入队** | 拖拽视频文件到窗口 → 加入转码队列（支持多选、批量） |
| **C10** | **输出文件夹必选** | 普通模式必须由用户指定有效输出文件夹，否则禁用"开始" |

---

## 三、技术选型

| 层次 | 选型 | 说明 |
|---|---|---|
| 框架 | **Electron** | 主进程(Node.js) + 渲染进程(Chromium) |
| 渲染框架 | **React 18 + TypeScript** | UI 层 |
| 构建工具 | **Vite + electron-vite** | HMR 快、TS 开箱即用 |
| 状态管理 | **Zustand** | 队列/参数/配置状态 |
| UI 组件 | 自建组件 + TailwindCSS（无第三方 UI 库） | 拖拽区、表单、弹窗、Switch、Tooltip、进度条等 |
| 样式 | TailwindCSS | 现代界面 |
| 主进程逻辑 | **Node.js (TypeScript)** | ffmpeg 调用、决策树、硬件探测、配置读写 |
| IPC | `ipcMain` / `ipcRenderer`（contextBridge 安全桥） | 前后端通信 |
| 转码引擎 | **FFmpeg（根目录分发）** | `child_process.spawn` |
| 媒体探针 | **FFprobe**（随 FFmpeg 分发） | 获取源文件分辨率/码率/帧率 |
| 持久化 | **单一 `config.json`（根目录）** | §6 |
| 打包 | **electron-builder** | NSIS / dmg，内含 ffmpeg + config.json |

---

## 四、架构设计

### 4.1 进程模型

```
┌──────────────────────────────────────────────────┐
│  渲染进程 (Chromium + React + TS)                 │
│  - 拖拽区 / 队列 / 普通&专家模式 / 参数预览 / 进度  │
│  - 通过 preload 暴露的 window.api 调用主进程       │
└────────────────┬─────────────────────────────────┘
                 │  contextBridge (安全 IPC)
┌────────────────▼─────────────────────────────────┐
│  Preload (preload.ts)                             │
│  - 桥接 ipcRenderer → window.api.*                │
└────────────────┬─────────────────────────────────┘
                 │  ipcMain.handle / ipcMain.on
┌────────────────▼─────────────────────────────────┐
│  主进程 (Node.js + TS)                            │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │  config  │  │ hardware │  │  media-probe  │   │
│  │ (读写JSON)│  │ (GPU探测)│  │  (ffprobe)   │   │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │             │                │           │
│  ┌────▼─────────────▼────────────────▼───────┐   │
│  │           simpleDecision (§7 决策树)           │   │
│  │  - 是否转码 / 分辨率开关 / 码率自动计算        │   │
│  │  - capRule 封顶 (C6)                        │   │
│  ├──────────────────────────────────────────────┤   │
│  │         transcoder (命令构建 / 进程调度)        │   │
│  └────┬───────────────────────────────────────┘   │
│       │ child_process (spawn)                    │
│  ┌──────────┐  ┌──────────┐                      │
│  │ ffmpeg   │  │ ffprobe  │                      │
│  │ (根目录) │  │ (根目录) │                      │
│  └──────────┘  └──────────┘                      │
└──────────────────────────────────────────────────┘
```
> ⚠️ 设计稿旧图含 `yt-dlp`（下载模块），**当前未实现**（见 §1.1.1），已从图中移除。

### 4.2 关键设计原则
- **决策树（simpleDecision）只在主进程**：渲染进程只收集"用户意图 + 拖入文件"，主进程结合源信息算出"真实生效值"再回传展示（C6、C7）
- **配置读写集中在主进程**：渲染进程不直接碰文件系统
- **ffmpeg 路径统一由主进程解析**：始终指向应用根目录（C5）

---

## 五、应用根目录与路径

### 5.1 根目录定义

```ts
// src/main/utils/paths.ts
import { app } from 'electron';
import path from 'path';

/** 应用根目录：开发态=项目根；打包后=主进程可执行文件所在目录 */
export function appRoot(): string {
  if (app.isPackaged) {
    return path.dirname(process.execPath); // Win: .../VideoTranscoder/
                                           // Mac: .../xxx.app/Contents/MacOS
  }
  return process.cwd();
}

export const configPath  = () => path.join(appRoot(), 'config.json');
export const ffmpegPath  = () => path.join(appRoot(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
export const ffprobePath = () => path.join(appRoot(), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
```

### 5.2 根目录布局

```
VideoTranscoder/
├── VideoTranscoder(.exe)        # 主进程可执行
├── config.json                  # ★ 唯一配置文件（应用根目录，用户可编辑）
├── ffmpeg                      # ★ FFmpeg（应用根目录）
```

> ⚠️ **写权限**：Windows 安装到 `Program Files` 后根目录只读。启动时若 `config.json` 不可写，**自动 fallback 到 `app.getPath('userData')`** 存放配置并在 UI 提示；读取时优先 userData、其次根目录（便携版）。FFmpeg 仍固定读根目录。

---

## 六、配置设计（单一 config.json）

### 6.1 完整 Schema

```json
{
  "version": "1.0",
  "language": "zh-CN",
  "theme": "system",

  "paths": {
    "ffmpeg": "",
    "ffprobe": "",
    "outputDir": ""
  },

  "transcode": {
    "parallelJobs": 1,
    "preferredHW": "auto",
    "fallbackToSoftware": true,
    "overwrite": "ask"
  },

  "simpleMode": {
    "enabled": true,
    "videoCodec": "hevc",
    "container": "mp4",
    "target": {
      "resolution": 1080,
      "fps": 30,
      "bitrateMbps": 6
    },
    "scaleResolution": true,
    "autoBitrateBaseMbps": 6
  },

  "expertDefaults": {
    "videoCodec": "hevc",
    "resolutionMode": "source",
    "fpsMode": "source",
    "bitrateMode": "crf",
    "crf": 23,
    "audioCodec": "aac",
    "audioBitrateKbps": 192,
    "sampleRate": 48000,
    "channels": 2,
    "container": "mp4",
    "extraArgs": []
  },

  "presets": {
    "custom": [
      { "id": "u-001", "name": "我的B站投稿", "options": { "...": "..." } }
    ]
  },

  "hardware": {
    "autoDetect": true,
    "allow": ["nvenc", "qsv", "videotoolbox", "mps", "amf", "vaapi"],
    "force": null
  },

  "advanced": {
    "showCommandPreview": true,
    "preventSleep": true
  }
}
```
> **与代码的差异（v5.0 校正）**：
> - `theme` 实际取值为 `"system" | "light" | "dark"`，代码默认值 `DEFAULT_CONFIG.theme = 'dark'`（`constants.ts`）；随包发放的 `config.json` 写入的是 `"system"`。
> - `language` 实际取值为 `"auto"` 或某个语言码（如 `zh-CN`），`"auto"` = 跟随系统语言（匹配不到回退英语）。
> - `advanced.preventSleep`（转码时阻止系统休眠）为**实际存在且生效**的字段。
> - ⚠️ 随包 `config.json` 中仍残留 `download: { enabled, proxy, subtitles }` 段，但**代码不使用**——`AppConfig` 类型未包含该字段，下载功能未实现（见 §1.1.1），后续应清理。
```

> **要点**：
> - `simpleMode.target` = `{1080, 30, 6}` → **统一配置（C3 默认 H.265）**
> - `simpleMode.scaleResolution` → 「是否调整分辨率」开关的持久化值
> - `paths.outputDir` → 输出文件夹（**普通模式必填，C10**）
> - 简单模式**不再区分低/中/高三档**（v3 改为单一配置）；专家模式保留自定义预设（C8）

### 6.2 输出文件夹（C10）
- 普通模式**必须由用户通过文件夹选择器指定** `paths.outputDir`
- 若 `outputDir` 为空或无效 → 「开始转码」按钮禁用，UI 提示"请先选择输出文件夹"
- 每次成功转码后记住该路径（下次默认），但仍允许用户随时更换

---

## 七、核心：普通（简单）模式决策树（C6 / C9 / C10）

> **这是 v3 最重要的逻辑，集中在主进程 `transcoder/simpleDecision.ts`。**  
> 统一配置 `TARGET = { resolution: 1080, fps: 30, bitrateMbps: 6, codec: 'hevc' }`。

### 7.1 决策规则（综合判断 B）

> **核心思想**：判断是否转码，不再只看分辨率，而是**综合"分辨率 + 码率"**——只要有一项高于统一配置，就值得重编码（把高的那项压下来）；只有**分辨率≤目标 且 码率≤目标**时才"无需转码"。

```
输入源 S = (width, height, fps, bitrateMbps)
TARGET = { resolution: 1080, fps: 30, bitrateMbps: 6 }

1. 规范化：用 height 代表分辨率档位
           (height<1080 → 低; ==1080 → 目标; >1080 → 高)

2. 判定"是否需要转码"（综合判断 B）:
   needByRes    = (S.height > 1080)              // 分辨率高于目标 → 需要（需缩放/对齐）
   needByRate   = (S.bitrateMbps > 6)            // 码率高于目标 → 需要（需压制）
   needByFps    = (S.fps > 30)                   // 帧率高于目标 → 需要
   needTranscode = needByRes || needByRate || needByFps || (codec 不符)

3. 若 !needTranscode:
       → decision = "no-op"  不转码
         (涵盖：1080p/30fps/6Mbps 完全符合者；也包括 720p/30fps/4Mbps 这种
          分辨率与码率都不超的"低规格"源)

4. 若 needTranscode:
   ┌─ 情形 A：分辨率更低但码率更高  (S.height < 1080 且 S.bitrateMbps > 6)
   │      → 【B 综合判断】仍转码！保留分辨率，压码率到 6Mbps
   │        例：720p/30fps/10Mbps → 720p/30fps/6Mbps
   │
   ├─ 情形 B：源等于目标 (S.height == 1080)
   │      → 按 TARGET 重编码 (1080p/30fps/6Mbps)
   │
   └─ 情形 C：源更高 (S.height > 1080，如 4K/1440p)
          → 显示开关「是否调整分辨率？」(simpleMode.scaleResolution)
          ├─ 是 (scale=true):  输出 = 1080p / 30fps / 6Mbps   (缩放至目标)
          └─ 否 (scale=false): 输出 = 保持源分辨率 / 30fps / 码率自动(见 §7.2)
```

**关键区别（A vs B）**：
- 旧逻辑(A)：`720p/10Mbps` → 因分辨率<1080 判"不转码"，白白放过可压缩空间 ❌
- 新逻辑(B)：`720p/10Mbps` → 码率>6 → **转码，保留 720p、压到 6Mbps** ✅（C6 满足：分辨率未提升、码率下降）

### 7.2 码率自动计算（scale=false 时）

```
base = 6 Mbps (@ 1080p = 1920×1080 = 2,073,600 px)
autoBitrate = base × (sourcePixels / refPixels)
            = 6 × (S.width × S.height) / (1920 × 1080)

特例：4K (height>=2160) → 24 Mbps  (= 6×4，与公式一致，显式列出)

封顶 (C6)：autoBitrate = min(autoBitrate, S.bitrateMbps)   // 绝不高于源码率
```

| 源分辨率 | 像素比 | 公式计算 | 封顶前 | 若源码率=10Mbps | 最终 |
|---|---|---|---|---|---|
| 4K (3840×2160) | 4.0 | 6×4 | 24 | min(24,10)=10 | **10** |
| 1440p (2560×1440) | 1.78 | 6×1.78 | 10.7 | min(10.7,10)=10 | **10** |
| 2K (2048×1080) | 1.07 | 6×1.07 | 6.4 | min(6.4,10)=6.4 | **6.4** |

> ✅ 4K → 24Mbps 正是公式的自然推论；封顶保证**绝不提升码率（C6）**。

### 7.3 分辨率封顶（C6）
- scale=true → 缩放到 1080p（**降低**，允许）
- scale=false → 保持源分辨率（**不提升**，允许）
- 两种情况都**不会把分辨率放大到超过源** ✅

### 7.4 TypeScript 实现

```ts
// src/main/transcoder/simpleDecision.ts
import { SourceInfo, SimpleDecision, Target, ResolvedParams } from '../types';

const TARGET: Target = { resolution: 1080, fps: 30, bitrateMbps: 6, codec: 'hevc' };
const REF_PIXELS = 1920 * 1080;

interface DecideCtx { scaleResolution: boolean; }

export function decideSimple(source: SourceInfo, ctx: DecideCtx): SimpleDecision {
  const srcPixels = source.width * source.height;
  const br = source.bitrateMbps ?? Infinity;   // 未知码率 → 视为"需要确认"，保守转码

  // 2) 综合判断：是否需要转码（分辨率 / 码率 / 帧率 / 编码任一超标）
  const needByRes  = source.height > TARGET.resolution;
  const needByRate = br > TARGET.bitrateMbps;
  const needByFps  = source.fps > TARGET.fps;
  const needTranscode = needByRes || needByRate || needByFps;

  // 3) 无需转码：分辨率、码率、帧率都不超
  if (!needTranscode) {
    return { action: 'no-op', reason: '源已符合统一配置（分辨率/码率/帧率均不超标），无需转码', params: null };
  }

  // 4) 情形 A：分辨率更低但码率更高 → 【B 综合判断】保留分辨率、压码率
  if (source.height < TARGET.resolution && needByRate) {
    return {
      action: 'transcode',
      reason: `分辨率 ${source.height}p 低于目标但码率偏高，保留分辨率并压制码率`,
      params: { ...TARGET, resolution: source.height, bitrateMbps: TARGET.bitrateMbps },  // 保留源分辨率, 6Mbps
    };
  }

  // 5) 情形 B：源等于目标 → 按 TARGET 重编码
  if (source.height === TARGET.resolution) {
    return { action: 'transcode', params: { ...TARGET } };
  }

  // 6) 情形 C：源更高 → 依据分辨率开关
  if (ctx.scaleResolution) {
    return { action: 'transcode', params: { ...TARGET } };   // 缩放到 1080p
  }
  // 保持分辨率，码率自动计算 + 封顶
  const auto = (TARGET.bitrateMbps * srcPixels) / REF_PIXELS;
  const capped = Math.min(auto, br);
  return {
    action: 'transcode',
    params: { ...TARGET, resolution: source.height, bitrateMbps: round1(capped) },
    autoBitrate: true,
  };
}

function round1(n: number) { return Math.round(n * 10) / 10; }
```

### 7.5 决策结果回传与展示（C7）
主进程把 `SimpleDecision` 回传渲染进程，`ResolvedParamsPanel` 展示：
- `no-op` → 灰色提示"无需转码"，禁用该项或标记跳过
- `transcode` → 绿色展示真实生效参数；若 `autoBitrate=true` 高亮"码率=自动计算 10.7Mbps（源上限 10 → 10）"
- **情形 A（分辨率低但码率高）**→ 蓝色标注"保留 720p，按 CRF 28 质量压制"（C6：分辨率未提升 ✅）
- 分辨率被缩放 / 码率被封顶 → 黄色标注前后变化

---

## 八、专家模式

- 自由配置：视频编码、分辨率、帧率、码率模式(CRF/CBR/VBR)、CRF、音频编码/采样率/声道、封装格式、硬件加速、自定义参数
- **所有参数同样过 §7.3 封顶（C6）**：用户填入高于源的值 → 自动封顶 + UI 黄色高亮（C7）
- **自定义预设（C8）**：基于当前配置"另存为" → 写入 `config.presets.custom`；支持重命名、覆盖、删除、导入/导出单个 `.json`
- 不再内置"低/中/高"预设（v3 起统一配置归简单模式；专家模式以自由配置 + 用户自建预设为主）

---

## 九、硬件加速与显卡自动侦测（含 Apple MPS）

### 9.1 侦测目标

| 平台 | 编码器 | FFmpeg codec | 触发条件 |
|---|---|---|---|
| Windows + NVIDIA | **NVENC** | `h264_nvenc` / `hevc_nvenc` | 检测到 NVIDIA GPU |
| Windows + Intel | **QuickSync** | `h264_qsv` / `hevc_qsv` | 检测到 Intel 核显 |
| Windows + AMD | **AMF** | `h264_amf` / `hevc_amf` | 检测到 AMD GPU |
| macOS (Intel) | **VideoToolbox** | `h264_videotoolbox` / `hevc_videotoolbox` | macOS 普遍可用 |
| macOS (Apple Silicon) | **VideoToolbox / MPS** | `hevc_videotoolbox` | **Apple M 系列 GPU (MPS)** |

> **Apple MPS**：FFmpeg 在 macOS 通过 VideoToolbox 调用 Apple Silicon GPU；Metal Performance Shaders 是其底层加速底座。侦测到 Apple Silicon 即认定具备 MPS/VideoToolbox，选用 `hevc_videotoolbox`。

### 9.2 侦测流程（Node.js 主进程）

```ts
// src/main/hardware/detector.ts
import { exec } from 'child_process';
import { platform } from 'os';

export interface HWCapability {
  nvenc: boolean; qsv: boolean; amf: boolean;
  videotoolbox: boolean; vaapi: boolean; mps: boolean;
  recommended: string;
}

export async function detect(): Promise<HWCapability> {
  const encoders = await getEncoders(); // `ffmpeg -hide_banner -encoders`
  const cap: HWCapability = {
    nvenc: /nvenc/i.test(encoders),
    qsv: /_qsv/i.test(encoders),
    amf: /_amf/i.test(encoders),
    videotoolbox: /videotoolbox/i.test(encoders),
    vaapi: /vaapi/i.test(encoders),
    mps: false, recommended: 'software',
  };
  if (platform() === 'darwin') {
    const arch = (await run('uname -m')).trim();
    cap.mps = arch === 'arm64' && cap.videotoolbox;   // Apple Silicon MPS
  }
  cap.recommended = cap.nvenc ? 'nvenc'
    : cap.qsv ? 'qsv'
    : cap.videotoolbox ? (cap.mps ? 'videotoolbox-mps' : 'videotoolbox')
    : cap.amf ? 'amf' : cap.vaapi ? 'vaapi' : 'software';
  return cap;
}
```

### 9.3 策略
- `preferredHW = "auto"`（默认）→ 按上表优先级择优
- 用户可在 UI / `config.hardware.force` 强制指定
- H.265 硬件编码需 GPU 支持（NVENC 2015+、Intel Gen9+、Apple Silicon 全系）；不支持时 UI 置灰并降级软件 `libx265`

---

## 十、FFmpeg 命令构建示例

> 所有命令中 `ffmpeg` 均指向**应用根目录**（C5）。

### 10.1 简单模式 · 缩放（scale=true，1080p/30/CRF 28/H.265 + NVENC）

```bash
./ffmpeg -y -i input.mov \
  -c:v hevc_nvenc -b:v 6M -maxrate 6M -bufsize 12M \
  -vf "scale=-2:1080" -r 30 \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  output.mp4
```

### 10.2 简单模式 · 保持分辨率（scale=false，4K/30/自动码率/H.265 MPS）

```bash
./ffmpeg -y -i input.mp4 \
  -c:v hevc_videotoolbox -b:v 24M -maxrate 24M \
  -r 30 \
  -c:a aac -b:a 192k \
  output.mp4
```

### 10.3 软件兜底（libx265）

```bash
./ffmpeg -y -i input.mp4 \
  -c:v libx265 -crf 28 -preset medium \
  -vf "scale=-2:720" -r 30 \
  -c:a aac -b:a 128k \
  output.mp4
```

### 10.4 旋转（元数据，不重编码）

```bash
./ffmpeg -y -i input.mp4 -c copy -metadata:s:v:0 rotate=90 output.mp4
```

### 10.5 音频提取（指定时段）

```bash
./ffmpeg -y -i input.mp4 -vn \
  -c:a libmp3lame -q:a 2 \
  -ss 00:01:00 -to 00:03:00 \
  output.mp3
```

### 10.6 视频拼接

#### 纯拼接（参数一致，不重编码，-c copy，秒级）

```bash
# 1. 生成片段清单 concat.txt
file '/abs/path/a.mp4'
file '/abs/path/b.mp4'
file '/abs/path/c.mp4'

# 2. concat demuxer 合并
./ffmpeg -y -f concat -safe 0 -i concat.txt -c copy output.mp4
```

> 要求：所有片段**编码参数、分辨率、帧率、时间基准(timebase) 完全一致**，否则 `-c copy` 会出现音画不同步/跳变。不一致时走下方"统一转码拼接"。

#### 统一转码拼接（参数不一致，先对齐再拼）

```bash
# 每个片段先按统一配置(§7)转码为统一中间文件，再 concat
./ffmpeg -y -i a.mov -c:v hevc_nvenc -b:v 6M -r 30 -s 1920x1080 \
                       -c:a aac -b:a 192k -ar 48000 -ac 2 a.conv.mp4
./ffmpeg -y -i b.mov ... b.conv.mp4
# ... 全部转码后 concat
./ffmpeg -y -f concat -safe 0 -i concat.txt -c copy final.mp4
```

#### 转码对齐（参数不一致，先对齐再拼，含音频统一 A 方案）

```bash
# 片段 a：有音轨 → 转码对齐到统一参数(§7) + 音频 48kHz 立体声
./ffmpeg -y -i a.mov \
  -c:v hevc_nvenc -b:v 6M -r 30 -s 1920x1080 \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  a.conv.mp4

# 片段 b：无音轨 → 补等长静音(anullsrc)，保证时长一致
./ffmpeg -y -i b.mov \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
  -c:v hevc_nvenc -b:v 6M -r 30 -s 1920x1080 \
  -c:a aac -b:a 192k -ar 48000 -ac 2 -shortest \
  b.conv.mp4

# ... 全部对齐后 concat
./ffmpeg -y -f concat -safe 0 -i concat.txt -c copy final.mp4
```

> `-shortest` 确保补的静音时长不超过视频时长；所有片段处理完后用 `concat demuxer` 合并。
> **基础流程到此为止（无转场）**；xfade 转场仅作专家模式扩展预留，MVP 不实现。

#### 拼接决策（主进程 `concatPlanner.ts`）

```
输入片段列表 segments[]
1. probe 全部 → 得到各自 SourceInfo（含 hasAudio / sampleRate / channels / duration）
2. 判断是否"参数一致":
     allEqual = segments.every(s => s.height===ref && s.fps===refFps && s.codec===refCodec
                                    && s.hasAudio===same && s.sampleRate===48000)
3. 若 allEqual 且 均无转场需求 → 纯拼接 (-c copy)，最快（不加任何转场）
   否则                       → 转码对齐 → 再 concat（见下方音频统一规则）

音频统一规则（转码对齐阶段强制，A 方案）:
  - 对每个片段：若存在音轨 → -c:a aac -b:a 192k -ar 48000 -ac 2
                若无音轨   → -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000
                             （补一段等长静音，时长=该片段时长）
  - 保证所有片段 视频时长 === 音频时长，避免 concat 后音画错位
```

> **备注（转场）**：基础流程**不做转场**，纯拼接即为"硬切直连"。
> 若后续作为专家模式扩展支持转场，则需强制走重编码 + `xfade` 滤镜（此时音频仍需按上述规则统一），
> 但 **MVP 阶段不实现**，避免增加 xfade 复杂度与破坏 -c copy 高速路径。

### 10.7 进度解析（结构化）

```bash
./ffmpeg -y -i input.mp4 -progress pipe:1 -nostats ... output.mp4
```

主进程读取 `pipe:1` 的 `frame= fps= out_time_ms= speed=` 键值对，通过 `webContents.send('progress', payload)` 推送给渲染进程。

---

## 十一、类型定义（前后端共享）

```ts
// src/shared/types.ts（节选，与实际实现一致）
export type VideoCodec = 'hevc' | 'h264' | 'av1' | 'vp9' | 'copy';
export type Container  = 'mp4' | 'mkv' | 'mov' | 'webm';
export type AudioCodec = 'aac' | 'mp3' | 'opus' | 'flac' | 'wav' | 'none';
export type HWKind = 'nvenc' | 'qsv' | 'amf' | 'videotoolbox' | 'videotoolbox-mps' | 'vaapi' | 'software';
export type BitrateMode = 'crf' | 'cbr' | 'vbr';
export type ResolutionMode = 'source' | 'custom';
export type FpsMode = 'source' | 'custom';

export interface SourceInfo {
  width: number;
  height: number;
  fps: number;
  bitrateMbps?: number;   // ffprobe 可能拿不到 → undefined（不封顶）
  durationSec: number;
  codec: string;
  hasAudio: boolean;      // ★ v4.1 拼接音频统一需要
  sampleRate?: number;
  channels?: number;
  audioCodec?: string;
  fileSizeBytes?: number;
}

export interface Target {
  resolution: number;     // 长边/高度档位，如 1080
  fps: number;
  bitrateMbps: number;
  codec: VideoCodec;
}

export interface ResolvedParams extends Target {
  container: Container;
  audioCodec: AudioCodec;
  audioBitrateKbps: number;
  sampleRate: 44100 | 48000 | 96000;
  channels: number;
  hwCodec?: string;       // 实际选用的硬件编码器
  capped: boolean;
  caps: { resolution: boolean; bitrate: boolean; fps: boolean };
  crf?: number;           // CRF / 质量模式生效值（压缩任务）
}

export interface SimpleDecision {
  action: 'transcode' | 'no-op';
  reason?: string;
  params: ResolvedParams | null;
  autoBitrate?: boolean;
}

export interface QueueItem {
  id: string;
  input: string;
  source: SourceInfo;
  mode: 'simple' | 'expert';
  scaleResolution: boolean;
  resolved: ResolvedParams | null;
  decision: SimpleDecision;
  outputDir: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error' | 'cancelled';
  output?: string;
  error?: string;
}

// ---- 视频拼接 (v4 / v4.1) ----
export interface Segment {
  id: string;
  input: string;
  source: SourceInfo;
  trim?: { startSec: number; endSec: number };
}

export type ConcatStrategy = 'copy' | 'transcode';

export interface ConcatPlan {
  strategy: ConcatStrategy;          // MVP: 仅 copy / transcode（不含转场）
  reason: string;
  uniform: ResolvedParams;           // 转码对齐时使用的统一参数(§7)
  audio: { sampleRate: 48000; channels: 2; silenceOnMissing: true }; // v4.1 A 方案
  segments: Segment[];
  silenceSegments: string[];         // ★ 需要补静音的片段 id
  totalDurationSec: number;          // ★ 预计总时长
  estimate: 'fast' | 'normal' | 'slow'; // ★ 耗时等级
}

export interface SegmentInfo {
  id: string; input: string; name: string;
  source: SourceInfo; hasAudio: boolean;
  thumbnail?: string; trim?: { startSec: number; endSec: number };
}

// ---- 硬件 ----
export interface HWCapability {
  nvenc: boolean; qsv: boolean; amf: boolean;
  videotoolbox: boolean; vaapi: boolean; mps: boolean;
  recommended: HWKind;
  platform: NodeJS.Platform; arch: string; encoders: string[];
}

// ---- 专家模式 / 预设 ----
export interface ExpertOptions {
  videoCodec: VideoCodec;
  hw: 'auto' | HWKind | 'software';
  resolutionMode: ResolutionMode; resolution?: number;
  fpsMode: FpsMode; fps?: number;
  bitrateMode: BitrateMode; crf?: number; bitrateMbps?: number;
  audioCodec: AudioCodec; audioBitrateKbps: number;
  sampleRate: 44100 | 48000 | 96000; channels: number;
  container: Container; preset?: string; extraArgs: string[];
}

export interface Preset {
  id: string; name: string; options: ExpertOptions; createdAt: string;
}

// ---- 任务（统一 payload）----
export type TaskKind = 'transcode' | 'rotate' | 'extractAudio' | 'concat';
export type RotateMode = 0 | 90 | 180 | 270;
export type FlipMode = 'none' | 'horizontal' | 'vertical';
export interface RotateOptions { mode: RotateMode; flip: FlipMode; metadataOnly: boolean; }
export interface AudioExtractOptions {
  codec: AudioCodec; bitrateKbps: number;
  sampleRate: 44100 | 48000 | 96000; channels: number;
  startSec?: number; endSec?: number;
}
export interface TaskPayload {
  id: string; kind: TaskKind; input: string; output: string;
  durationSec: number; trim?: { startSec: number; endSec: number };
  params?: ResolvedParams; rotate?: RotateOptions;
  audio?: AudioExtractOptions; concat?: { segments: Segment[]; plan: ConcatPlan };
}

// ---- 进度 / 导入 ----
export interface ProgressPayload {
  id: string; taskId: string; percent: number; frame: number;
  fps: number; speed: number; outTimeSec: number; etaSec?: number;
  status: TaskStatus; message?: string;
}
export interface ImportProgressPayload {
  phase: 'scan' | 'probe'; done: number; total: number;
  found?: number; folders?: number;
}
```

> 注：`AppConfig` 完整定义见 `src/shared/types.ts`（含 `paths / transcode / simpleMode / expertDefaults / presets / hardware / advanced`；
> 注意**不含 `download` 字段**——`config.json` 中的 `download` 段为历史残留，代码未消费，见 §1.1.1）。

---

## 十二、IPC 通道契约

| Channel | 方向 | 入参 | 返回 | 说明 |
|---|---|---|---|---|
| `config:get` | R→M | — | `{config, storageMode}` | 读取 config.json（含根目录/ userData 标记） |
| `config:save` | R→M | `AppConfig` | `void` | 写回 config.json |
| `preset:save` | R→M | `{name, options, id?}` | `Preset` | 保存/更新自定义预设(C8) |
| `preset:delete` | R→M | `id` | `Preset[]` | 删除预设 |
| `preset:import` | R→M | — | `Preset` | 文件选择导入 `.json` 预设 |
| `preset:export` | R→M | `id` \| `{name, options}` | `boolean` | 导出预设（按 id 或当前专家设置） |
| `hardware:detect` | R→M | `force?` | `HWCapability` | 显卡侦测(含 MPS) |
| `media:probe` | R→M | `filePath` | `SourceInfo` | ffprobe 获取源信息 |
| `media:thumbnail` | R→M | `{input, seekSec?}` | `string` | 生成缩略图（拼接预览用） |
| `queue:add` | R→M | `{filePaths, outputDir, scaleResolution?, mode?, expert?}` | `QueueItem[]` | **拖拽/文件夹入队，递归展开+批量探针+决策(C9)** |
| `simple:decide` | R→M | `{source, scaleResolution?}` | `SimpleDecision` | **§7 决策树(C6/C7)** |
| `params:resolve` | R→M | `{source, options}` | `ResolvedParams` | 专家模式封顶计算(§8) |
| `command:build` | R→M | `{payload, source?}` | `{command?}`/`{commands?}` | 命令预览(C7) |
| `concat:plan` | R→M | `{inputs?/segments?, scaleResolution?, expert?}` | `ConcatPlan` | **拼接方案(纯拼/转码对齐，无转场)(§10.6)** |
| `concat:preview` | R→M | `{inputs, withThumbnail?}` | `SegmentInfo[]` | 片段一致性检测、缩略图 |
| `task:start` | R→M | `TaskPayload[]` | `{taskId}` | 开始转码/旋转/提取/拼接 |
| `task:cancel` | R→M | `id?` | `boolean` | 取消（全部或指定） |
| `task:pause` / `task:resume` | R→M | — | `boolean` | 任务暂停/恢复 |
| `select:outputDir` | R→M | `current?` | `{dir, error}` | **输出文件夹选择器(C10，含写权限校验)** |
| `select:files` | R→M | — | `string[]` | 文件选择（多选） |
| `select:folder` | R→M | `current?` | `string` | 文件夹选择（含子目录） |
| `files:expand` | R→M | `string[]` | `{files, folders, truncated, expandedFromFolders}` | 路径展开（递归扫描视频） |
| `open:path` | R→M | `target` | `void` | 在资源管理器/访达中打开 |
| `power:set` | R→M | `enabled` | `{enabled}` | 转码时防休眠开关 |
| `theme:set` | R→M | `mode` | — | 主题推送（实际由 config 持久化，桥接保留） |
| `progress` (event) | M→R | — | `ProgressPayload` | 进度推送 |
| `log` (event) | M→R | — | `string` | 日志推送 |
| `task:status` (event) | M→R | — | `{id, status, ...}` | 任务状态变更 |
| `import:progress` (event) | M→R | — | `ImportProgressPayload` | 文件夹扫描/批量探针进度 |
| `config:changed` / `power:state` / `app:env` (event) | M→R | — | 各类 | 配置变更 / 防休眠状态 / 系统环境（语言） |

---

## 十三、UI / 页面结构

### 13.1 拖拽入队（C9）

```
┌────────────────────────────────────────────────────┐
│  ⬇ 拖拽视频文件到此处（支持多选 / 批量）             │
│     → 松开后自动 ffprobe 探针 + 决策树计算           │
├────────────────────────────────────────────────────┤
│  转码队列：                                          │
│  ┌────────────────────────────────────────────────┐ │
│  │ 🎬 input_a.mp4   4K 30fps 20Mbps               │ │
│  │    → 1080p/30fps/6Mbps (缩放)  NVENC  [✓]      │ │
│  ├────────────────────────────────────────────────┤ │
│  │ 🎬 clip_b.mp4   720p 30fps 4Mbps               │ │
│  │    → ⚠ 无需转码（源低于 1080p）  [跳过]         │ │
│  ├────────────────────────────────────────────────┤ │
│  │ 🎬 movie_c.mov  4K 24fps 10Mbps                │ │
│  │    → 4K/30fps/10Mbps (码率自动·已封顶)  MPS    │ │
│  └────────────────────────────────────────────────┘ │
│  [清空队列] [从文件夹添加]                           │
└────────────────────────────────────────────────────┘
```

**拖拽行为**：
- 监听窗口 `dragover` / `drop`，过滤非视频文件（按扩展名 + 可选 ffprobe 校验）
- 多选拖入 → 批量 `queue:add` → 主进程逐个探针 → 逐项计算决策 → 回传填充队列
- 每个队列项独立保存源信息、决策结果、输出文件夹、开关状态

> **拼接页签同理**：拖入/添加多个片段后，在主进程 `concat:plan` 里一次性 probe + 一致性判断 + 生成拼接方案（§10.6）。

### 13.2 普通模式面板（§7 规则可视化）

```
┌─ 普通模式（统一配置：1080p / 30fps / CRF 28 / H.265）─┐
│                                                      │
│  输出文件夹：[ ~/Movies/Output    ] [浏览...]  ← C10 │
│                                                      │
│  每个视频的决策（见下方队列）:                         │
│  • 源 < 1080p  → 不转码                              │
│  • 源 = 1080p  → 符合则不转，否则按统一配置          │
│  • 源 > 1080p  → 是否调整分辨率？                    │
│        ⚪ 是（缩放到 1080p / 30fps / 6Mbps）          │
│        ⚪ 否（保持分辨率 / 30fps / 码率自动）← 默认   │
│                                                      │
│  [★ 生效参数预览]  命令预览[折叠]                     │
└──────────────────────────────────────────────────────┘
```

### 13.3 专家模式面板
- 自由配置视频编码/分辨率/帧率/码率模式/CRF/音频/容器/硬件/自定义参数
- 任何高于源的值 → 黄色高亮"已封顶"(C7)
- [另存为预设] → 写入 `config.presets.custom`

### 13.4 拼接页签（ConcatPage，v4）

```
┌────────────────────────────────────────────────────┐
│  🎬 拼接   ⬇ 拖入多个视频片段（自动排序）           │
├────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐  │
│  │ ☰ ① intro.mp4   1080p 30fps  🔊 有音  [✏裁剪]│  │
│  │ ☰ ② main.mov    4K 30fps     🔊 有音  [✏裁剪]│  │
│  │ ☰ ③ ending.mp4  1080p 30fps  🔇 无声  [✏裁剪]│  │
│  └──────────────────────────────────────────────┘  │
│  [↑↓ 拖拽调整顺序]  [+ 添加片段]  [清空]            │
├────────────────────────────────────────────────────┤
│  ★ 拼接方案预览：                                   │
│  • 检测到参数不一致 → 转码对齐(§7 统一配置)         │
│  • 音频：全部统一 48kHz / 立体声                    │
│  • ending.mp4 无音轨 → 自动补静音                  │
│  • 预计耗时：约 3 分钟        ← 无转场，硬切直连    │
│  • 命令预览[折叠]                                   │
├────────────────────────────────────────────────────┤
│  输出文件夹：[📁 选择输出文件夹]   C10              │
│  [▶ 开始拼接]                                      │
└────────────────────────────────────────────────────┘
```

**交互要点**：
- 拖入即 `concat:preview` → 一致性检测 + 显示每个片段的音轨状态（🔊/🔇）
- **无转场选项**（MVP 硬切直连），方案摘要明确告知"纯拼接 / 转码对齐"及音频处理方式
- 无声片段在摘要里标注"将补静音"，让用户心里有数
- 输出文件夹必选（同 C10 规则），未选禁用"开始"

### 13.5 全局布局

```
┌────────────────────────────────────────────────┐
│  顶部栏：Logo · 语言 · 主题 · 设置(⚙)           │
├────────────────────────────────────────────────┤
│  Tab（实际 4 个）：转码 | 旋转 | 提取音频 | 拼接                  │
│                                                │
│  ⬇ 拖拽视频文件到此处（多选入队）  ← C9         │
│                                                │
│  模式：🔘普通  🔘专家                            │
│                                                │
│  [普通模式面板 / 专家模式面板]   (§13.2 / §13.3) │
│                                                │
│  ★ 生效参数预览（真实值 + 封顶/自动标注）  C7    │
│  [▶ 开始转码]  ← 输出文件夹未选时禁用  C10       │
├────────────────────────────────────────────────┤
│  任务队列 / 进度条 / 日志                        │
└────────────────────────────────────────────────┘
```

---

## 十三·B、多语言（i18n）【v5.0 新增，实际已实现】

轻量自研 i18n（不依赖第三方库），**所有界面文案**集中在 `src/renderer/i18n/locales/*.json`（扁平 key），含 **10 种语言**：

| 语言码 | 名称 | 语言码 | 名称 |
|---|---|---|---|
| `zh-CN` | 简体中文 | `fr` | Français |
| `zh-TW` | 繁體中文 | `es` | Español |
| `ja` | 日本語 | `pt` | Português |
| `ko` | 한국어 | `de` | Deutsch |
| `en` | English | `it` | Italiano |

**机制**：
- 文案文件：`zh-CN / zh-TW / ja / ko / en / fr / es / pt / de / it`（共 10 份）。
- `useT()`（组件内）/`t()`（非组件）取当前 `locale` 翻译；未命中 key → **回退英语** → 再回退 key 本身，保证不白屏。
- 语言选择 `LanguageSwitch`：用户可在顶栏选择具体语言，或选 `auto`（跟随系统）。
- `resolveLocale()`：把系统语言（`app.getLocale()`，如 `zh-Hant-TW`/`zh-Hans-CN`/`pt-BR`）映射到支持列表，匹配不到回退 `en`。
- 初始化：`useI18nStore.init(systemLocale, config.language)`，其中 `config.language === 'auto'` 时取系统匹配语言。
- 新增 key 须同步写入 10 份 locale（未写入的语言暂用英文回退）。

> ⚠️ **本地化覆盖率**：旋转 / 提取音频 / 拼接 / 拖拽区等页面的主文案已完成 10 语言翻译；个别动态提示（如错误回显、日志行）仍可能为中文硬编码，后续需持续收敛。

---

## 十四、项目目录结构（开发态）

```
video-transcoder/                         # 包名 echo-video-transcoder
├── config.json                    # ★ 单一配置文件（开发态根目录，打包后随应用）
├── ffmpeg/                       # ★ FFmpeg（开发态根目录，打包后随应用）
│   └── bin/{ffmpeg,ffprobe,ffplay}.exe
├── package.json                  # scripts: dev / build / dist(=build+electron-builder)
│
├── src/
│   ├── main/                      # ★ 主进程 (Node.js + TS)
│   │   ├── index.ts               # app 生命周期、窗口、拖拽文件接收、IPC 注册
│   │   ├── ipc/                   # IPC 通道（对应 §12）
│   │   │   ├── index.ts           # registerAllIpc()
│   │   │   ├── config.ipc.ts      # config:get/save、preset:*、select:*、open:path
│   │   │   ├── files.ipc.ts       # select:folder、files:expand（递归扫描子目录）
│   │   │   ├── hardware.ipc.ts    # hardware:detect
│   │   │   ├── media.ipc.ts       # media:probe、media:thumbnail
│   │   │   ├── queue.ipc.ts       # queue:add（拖拽入队 + 批量探针 + 决策）
│   │   │   ├── simple.ipc.ts      # simple:decide、params:resolve、command:build
│   │   │   ├── concat.ipc.ts      # concat:plan、concat:preview
│   │   │   └── task.ipc.ts        # task:start/cancel/pause/resume、power:set
│   │   ├── config/configStore.ts  # ★ 根目录/ userData 双路径 config.json 读写
│   │   ├── hardware/detector.ts   # ★ 显卡侦测（含 Apple MPS，缓存）
│   │   ├── media/probe.ts         # ffprobe 探针 + 缩略图
│   │   ├── media/scan.ts          # expandPaths（递归扫描子文件夹视频）
│   │   ├── transcoder/            # ★ 转码核心
│   │   │   ├── simpleDecision.ts  # ★ §7 简单模式决策树
│   │   │   ├── capRule.ts         # ★ 分辨率/码率/帧率封顶 (C6)
│   │   │   ├── autoBitrate.ts     # ★ §7.2 码率自动计算
│   │   │   ├── expertParams.ts    # 专家模式参数封顶解析
│   │   │   ├── commandBuilder.ts  # 命令参数构建
│   │   │   ├── taskRunner.ts      # 任务队列 / 并发 / 取消 / 防休眠
│   │   │   └── progressParser.ts  # -progress 解析
│   │   ├── concat/                # ★ 视频拼接 (v4)
│   │   │   ├── concatPlanner.ts   # ★ 拼接方案决策 (§10.6)
│   │   │   ├── segmentProbe.ts    # 片段一致性检测 / 缩略图
│   │   │   └── commandBuilder.ts  # concat 命令构建（含补静音）
│   │   ├── download/              # ⚠️ 空目录：下载(ytd-dlp) 未实现（见 §1.1.1）
│   │   ├── system/powerSave.ts    # 转码期间阻止系统休眠
│   │   └── utils/                 # paths.ts（根目录/ffmpeg/config）、broadcast.ts
│   │
│   ├── preload/preload.ts         # ★ contextBridge 安全桥 → window.api（§12 右列）
│   │
│   ├── shared/                    # ★ 前后端共享类型/常量/纯函数
│   │   ├── types.ts               # §11（AppConfig / SourceInfo / ConcatPlan / TaskPayload …）
│   │   ├── constants.ts           # TARGET、IPC 通道枚举、编码器映射、DEFAULT_CONFIG
│   │   └── params.ts              # resolveExpertParams 纯函数（渲染/主进程共用）
│   │
│   └── renderer/                  # ★ 渲染进程 (React + TS)
│       ├── main.tsx
│       ├── App.tsx                # 顶栏(硬件徽标/主题/语言) + 4 个 Tab
│       ├── i18n/                  # ★ 多语言（§十三·B）
│       │   ├── index.ts           # SUPPORTED / resolveLocale / useT
│       │   └── locales/*.json     # 10 份：zh-CN/zh-TW/ja/ko/en/fr/es/pt/de/it
│       ├── pages/                 # ★ 实际仅 4 页（无 Compress/Download）
│       │   ├── TranscodePage.tsx  # 拖拽区 + 普通/专家模式 + 队列 + 命令预览
│       │   ├── RotatePage.tsx
│       │   ├── ExtractAudioPage.tsx
│       │   └── ConcatPage.tsx     # ★ 视频拼接 (v4)
│       ├── components/
│       │   ├── DropZone.tsx           # ★ 通用拖拽入队 (C9)
│       │   ├── QueueList.tsx          # ★ 队列（每项含决策结果）
│       │   ├── mode/
│       │   │   ├── SimpleMode.tsx     # ★ 普通模式（§13.2）
│       │   │   └── ExpertMode.tsx     # 专家模式（含 PresetManager）
│       │   ├── ScaleResolutionSwitch.tsx  # ★ 「是否调整分辨率」
│       │   ├── OutputFolderPicker.tsx     # ★ 输出文件夹选择 (C10)
│       │   ├── ResolvedParamsPanel.tsx    # ★ 生效参数预览 (C7)
│       │   ├── AutoBitrateHint.tsx        # ★ 码率自动/封顶提示
│       │   ├── PresetManager.tsx          # 自定义预设：保存/导出/导入（C8，按钮独占一行）
│       │   ├── HardwareBadge.tsx          # 显卡徽标（含 MPS）
│       │   ├── CommandPreview.tsx
│       │   ├── ProgressBar.tsx
│       │   ├── Switch.tsx / Tooltip.tsx   # 自研基础控件
│       │   ├── ImportProgress.tsx         # 文件夹扫描/批量探针进度
│       │   ├── LogModal.tsx               # 日志弹窗
│       │   ├── LanguageSwitch.tsx         # ★ 语言切换（含 auto）
│       │   ├── ThemeSwitch.tsx            # 主题切换（system/light/dark）
│       │   └── concat/                # ★ 拼接相关组件 (v4)
│       │       ├── SegmentList.tsx        # ★ 片段列表（拖拽排序）
│       │       ├── SegmentTrim.tsx        # 首尾裁剪弹窗
│       │       └── ConcatPlanSummary.tsx  # 拼接方案摘要（纯拼/转码对齐 + 音频统一说明）
│       ├── stores/   # Zustand: configStore / queueStore / paramStore / concatStore
│       │             #         + dropStore / importStore / themeStore / uiStore
│       ├── hooks/    # useDropHandler / useHardware …（同 §12 IPC 封装）
│       ├── utils/    # files（拖拽路径解析）/ output（输出路径生成）
│       └── styles/  # Tailwind 入口 + CSS 变量（暗色主题为主）
│
├── resources/
├── build/                         # electron-builder 配置
├── package.json
├── tsconfig.json
├── electron.vite.config.ts
└── docs/
```

### 14.1 打包配置（electron-builder）

```jsonc
// package.json (节选)
{
  "build": {
    "extraResources": [
      { "from": "ffmpeg/bin", "to": "." }   // ★ 实际路径：ffmpeg/bin 整体拷到应用根目录
    ],
    "win": { "target": "nsis" },
    "mac": { "target": "dmg", "category": "public.app-category.video" }
  }
}
```

> ⚠️ 设计稿旧版写 `ffmpeg/${os}`，实际 `package.json` 为 `ffmpeg/bin`（详见仓库根 `package.json` 的 `build.extraResources`）。

---

## 十五、开发里程碑

| 阶段 | 周期 | 交付内容 | **v5.0 实际状态** |
|---|---|---|---|
| **M1 骨架** | 2 周 | electron-vite 工程、根目录 FFmpeg 集成、**拖拽入队(C9)**、基础转码跑通 | ✅ 已完成 |
| **M2 转码核心** | 3 周 | **§7 决策树 + 码率自动计算**、封顶算法、硬件侦测(含 MPS)、**输出文件夹(C10)**、进度/取消 | ✅ 已完成 |
| **M3 功能补齐** | 3 周 | 旋转、音频提取、**视频拼接(纯拼/转码对齐 + 音频统一A方案，不含转场)**、config.json 读写、自定义预设(C8) | ✅ 已完成（**压缩并入转码**，未单列） |
| **M4 下载模块** | 2 周 | yt-dlp 集成、下载 + 转码一体化 | ❌ **未实现**（见 §1.1.1） |
| **M5 体验打磨** | 2 周 | 队列优化、主题、**国际化(10 语言)**、生效参数预览(C7) | 🟡 部分完成（主题 + i18n 10 语 + C7 预览已做；仍有零散中文硬编码） |
| **M6 打包发布** | 2 周 | 签名公证（macOS notarization / Windows 签名）、自动更新 | 🟡 仅本地 `npm run dist` 可出安装包；签名/自动更新未做 |

> ⚠️ 里程碑为设计稿原计划，实际开发节奏与计划不完全一致；**下载(M4)暂缓、压缩(M3)并入转码、发布(M6)尚未签名**是当前与文档的主要偏差。

---

## 十六、关键技术风险与应对

| 风险 | 应对 |
|---|---|
| **C5** FFmpeg 体积大（~80MB） | 随应用打包；或首启动按需下载对应平台 binary |
| **C4** Apple MPS 识别不准 | `uname -m` + VideoToolbox encoder 双重确认 |
| **C6** 封顶逻辑被绕过 | **只在主进程 `capRule.ts` / `simpleDecision.ts` 实现**，所有入口必经，单元测试覆盖 |
| **C9** 拖拽大量文件卡顿 | 队列化探针（并发受限），Web Worker 解析不阻塞 UI |
| **C10** 输出文件夹无效/无写入权限 | 选择后用 `access` 校验 + 试写临时文件；非法则提示重选 |
| **C2** 根目录不可写（Program Files） | 检测写权限，不可写 fallback 到 userData 并提示 |
| 硬件加速兼容性差 | 探测失败自动降级软件编码，UI 明确提示 |
| macOS 签名公证拦截 | 对 FFmpeg 一并签名，hardened runtime 加白名单 |
| 下载模块（yt-dlp）法律/反爬风险 | ⚠️ **尚未实现**（见 §1.1.1），规划阶段风险；实现时再加免责声明，仅支持公开协议 |
| 进度解析不稳定 | 启用 `-progress pipe:1` 结构化输出 |
| GPU 多任务抢占 | 默认并发=1，并行时强制软件编码或排队 |

---

## 十七、开发约定

### 17.1 编码规范
- **TypeScript 严格模式**：`strict: true`，前后端共享类型放 `src/shared/`
- **决策树/封顶/自动码率必须有单元测试（vitest）**，覆盖 §7.2 表格全部用例 + §7.1 边界
- 主进程平台相关代码用 `process.platform` 分支，禁止渲染进程直接访问 fs/path
- 配置：新增字段带默认值，保证旧配置 merge 不报错

### 17.2 安全
- `contextBridge` + `nodeIntegration: false` + `sandbox: true`
- 文件路径经主进程校验，防路径遍历
- ffmpeg 参数化拼接，禁字符串拼接导致注入；`extraArgs` 白名单校验

---

## 附录 A：快速验证清单（冒烟测试）

### 普通模式决策树（§7，综合判断 B）
- [ ] 源 **720p** 30fps 4Mbps → 分辨率、码率、帧率都不超 → `no-op` ✅
- [ ] 源 **720p** 30fps **10Mbps** → **B 综合判断** → 转码，保留 720p、按 CRF 28 质量压制 ✅（C6：分辨率未提升）
- [ ] 源 **1080p** 30fps 6Mbps → `no-op` ✅
- [ ] 源 **1080p** 60fps 10Mbps → 按统一配置重编码(1080p/30/6) ✅
- [ ] 源 **4K** 30fps 20Mbps + 开关**是** → 缩放 1080p/30/6 ✅
- [ ] 源 **4K** 30fps 20Mbps + 开关**否** → 保持 4K/30/24Mbps ✅
- [ ] 源 **4K** 24fps **10Mbps** + 开关否 → 码率 `min(24,10)=10` 封顶 ✅ C6
- [ ] 源 **1440p** + 开关否 → 码率 = 6×1.78 = 10.7Mbps ✅

### 视频拼接（§10.6）
- [ ] 多个片段参数完全一致 → **纯拼接(-c copy)**，秒级完成，无重编码 ✅
- [ ] 片段参数不一致 → 自动**转码对齐**(沿用 §7 统一配置) → 再 concat ✅
- [ ] **音频统一(A 方案)**：有声片段 → `-ar 48000 -ac 2`；无声片段 → **补静音(anullsrc)** 且时长对齐 ✅
- [ ] 拼接后**音画时长严格一致**，无错位/报错 ✅
- [ ] **基础流程无转场**：纯拼接为硬切直连，不出现转场选项 ✅
- [ ] 拼接页签支持**拖拽排序**、首尾裁剪、缩略图预览 ✅
- [ ] 拼接方案摘要正确显示"纯拼接 / 转码对齐"及原因 ✅
- [ ] （扩展，非 MVP）转场(xfade)：仅专家模式，且强制重编码 ✅

### 硬约束
- [ ] 首次启动在应用根目录自动生成 `config.json`
- [ ] 根目录放置 `ffmpeg`，无需环境变量即可调用
- [ ] macOS Apple Silicon 显示"已侦测到 Apple MPS (VideoToolbox)"
- [ ] Windows NVIDIA 显示"已侦测到 NVIDIA NVENC"
- [ ] 简单模式默认编码 **HEVC (H.265)** ✅ C3
- [ ] **任何模式输出分辨率/码率不高于源** ✅ C6
- [ ] 封顶/自动码率在 UI 高亮展示真实值 ✅ C7
- [ ] **拖拽视频（多选）可加入队列**，每项独立决策 ✅ C9
- [ ] **未指定输出文件夹时「开始」禁用**；指定后可开始 ✅ C10
- [ ] 用户自定义预设可保存/导入/导出 ✅ C8

### 多语言 i18n（v5.0）
- [ ] 顶栏语言切换含 10 种语言 + `auto`（跟随系统）
- [ ] 系统语言为 `zh-Hant-TW` / `pt-BR` 等能正确映射到 zh-TW / pt
- [ ] 缺失文案回退英语，不白屏
- [ ] 旋转 / 提取音频 / 拼接 / 拖拽区主文案已完成 10 语言翻译

---

*本文档为 Electron 架构开发指导文档（v5.0），随开发推进持续更新。硬性约束（C1–C10）变更需产品评审确认。*
