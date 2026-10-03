# Echo Video Transcoder · 回声视频转码器

> 一款跨 Windows / macOS 的桌面端视频处理工具，基于 **Electron + React + TypeScript**，内置 **FFmpeg** 引擎。把专业、难记的 FFmpeg 命令封装成「拖拽即可用、参数可视化、**默认显卡加速**、**绝不劣化源片**」的桌面工具。

简体中文 · [English](readme.md)

---

## ✨ 功能特性

| 模块 | 说明 |
|---|---|
| 🎞️ **视频转码** | 格式 / 编码 / 分辨率 / 帧率 / 码率可调，**默认显卡加速**。普通模式套用统一质量配置；专家模式开放 CRF / CBR / VBR 与自定义预设。 |
| ✂️ **编辑** | 在一处完成裁切、旋转、翻转与背景音混合，配合逐帧时间轴预览。 |
| 🔄 **旋转 / 翻转** | 0° / 90° / 180° / 270° 及水平 / 垂直翻转。**优先元数据旋转（不重编码、秒级完成）**，仅在必要时回退重编码。 |
| 🎵 **提取音频** | 从视频中抽出音轨为 aac / mp3 / wav / flac / opus，可选起止时段。 |
| 🔗 **视频拼接** | 按顺序首尾相连多个片段。所有片段参数一致时走 **`-c copy` 纯拼接（秒级）**；不一致时先统一转码对齐，并为无声片段自动补静音。 |

### 核心亮点

- **零命令行** —— 把文件（或整个文件夹，自动递归扫描）拖进窗口即可入队。
- **绝不劣化** —— 输出分辨率 / 码率绝不高于源文件（硬性封顶规则）。
- **参数透明** —— 所有生效参数（含自动计算与封顶后的真实值）在开始前完整展示。
- **硬件加速** —— 自动侦测 NVIDIA NVENC、Intel QuickSync、AMD AMF、macOS VideoToolbox 及 **Apple Silicon MPS**，不可用时降级软件编码。
- **单一配置文件** —— 应用根目录下可手动编辑的 `config.json`。
- **10 种语言** —— 简体中文 / 繁體中文 / 日本語 / 한국어 / English / Français / Español / Português / Deutsch / Italiano，自动匹配系统语言。

### 普通模式质量档位

普通模式统一输出 **1080p / 30fps**，并按编码格式判定「是否需要转码」。不转码阈值与编码 CRF 都由**目标编码**决定，并随分辨率缩放（**4K = 1080p 的 ×4**）：

| 目标编码 | CRF | 1080p30 阈值 | 4K30 阈值 |
|---|---|---|---|
| H.264 | 21 | 6.0 Mbps | 24.0 Mbps |
| H.265 | 26 | 4.0 Mbps | 16.0 Mbps |
| VP9 | 30 | 4.0 Mbps | 16.0 Mbps |
| AV1 | 33 | 2.8 Mbps | 11.2 Mbps |

- 仅当分辨率 / 帧率 / 码率**全部不超标**时才判 `no-op`（不转码）。
- **现代编码之间（H.264 / H.265 / VP9 / AV1）不会仅因格式不同而重编码** —— 避免多次转码造成画质损失。
- **旧格式**（Xvid / MPEG-4 Part 2、MPEG-2、VC-1、VP8…）或探测不到编码的源，一律兜底转码为现代编码。
- `simpleMode.target.bitrateMbps` / `crf` 仍保留为可选的手动覆盖入口。

---

## 🚀 快速开始（开发）

### 环境要求

- Node.js 18+
- `ffmpeg/bin` 下提供 FFmpeg / FFprobe 可执行文件（或系统已安装，如果使用windows）

> **FFmpeg / FFprobe 说明**
> - **macOS：** 使用 Homebrew 安装 —— `brew install ffmpeg`。
> - **Windows（从源码编译）：** 请确保 `ffmpeg/bin` 目录下存在 **`ffprobe.exe`** 与 **`ffmpeg.exe`** 文件。

### 安装与运行

```bash
npm install        # 若 Electron 下载失败，请设置 ELECTRON_MIRROR（见常见问题）
npm run dev        # 带热更新的开发模式
```

### 构建与打包

```bash
npm run build      # 编译 main / preload / renderer
npm run dist       # 构建并打包安装包（Windows 为 NSIS，macOS 为 DMG）
npm run typecheck  # TypeScript 类型检查
npm test           # 单元测试（vitest）
```

打包产物输出到 `release/` 目录。

---

## ⚙️ 配置说明

应用读取应用根目录下的单一 `config.json`（根目录不可写时回退到用户数据目录）。其中保存语言、主题、输出文件夹、转码默认项、专家预设、硬件偏好等。

```jsonc
{
  "version": "1.0",
  "language": "auto",      // "auto" 表示跟随系统语言
  "theme": "system",       // "system" | "light" | "dark"
  "paths": { "outputDir": "" },
  "simpleMode": { "target": { "resolution": 1080, "fps": 30 } }  // bitrateMbps / crf 为可选手动覆盖
}
```

---

## ❓ 常见问题

**`npm install` 时 Electron 下载失败，报 `The server aborted pending request`。**
这是访问 GitHub Releases 的网络问题，使用镜像即可：

```bash
ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ npm install
```

或在项目根目录添加 `.npmrc`：

```ini
registry=https://registry.npmmirror.com/
electron_mirror=https://registry.npmmirror.com/-/binary/electron/
```

---

## 💖 赞助支持

Echo Video Transcoder 完全免费且开源。如果它为你节省了时间，欢迎赞助支持开发。

**PayPal：** [paypal.me/geniusjees](https://paypal.me/geniusjees)

**微信 / 支付宝** —— 扫描下方收款码：

| 微信 | 支付宝 |
|---|---|
| <img src="src/renderer/assets/wechat.png" alt="微信收款码" width="230" /> | <img src="src/renderer/assets/alipay.jpg" alt="支付宝收款码" width="230" /> |

> 同样的赞助信息也在软件内的 **赞助** 页面展示。

### 免责说明

赞助完全出于自愿，不构成任何商品或服务的购买行为。赞助**不授予**任何商业授权、优先支持或功能特权，且**不予退款**。本软件按「现状」提供，不附带任何形式的担保，作者不对因使用本软件而产生的任何损失承担责任。赞助不会影响产品决策或开源协议。

---

## 📄 开源协议

[MIT](LICENSE) © Echo Video Transcoder

---

## 🙏 致谢

- [FFmpeg](https://ffmpeg.org/) —— 媒体处理引擎
- [Electron](https://www.electronjs.org/)、[React](https://react.dev/)、[Vite](https://vitejs.dev/)、[Tailwind CSS](https://tailwindcss.com/)
