# Echo Video Transcoder

> A cross-platform (Windows / macOS) desktop video toolkit built with **Electron + React + TypeScript**, powered by a bundled **FFmpeg**. It turns hard-to-remember FFmpeg commands into a drag-and-drop, visual, GPU-accelerated experience that **never degrades your source footage**.

[简体中文](readme_cn.md) · English

---

## ✨ Features

| Module | Description |
|---|---|
| 🎞️ **Transcode** | Adjust format / codec / resolution / frame rate / bitrate. **GPU acceleration by default**. Simple mode applies a unified quality profile; Expert mode exposes CRF / CBR / VBR and custom presets. |
| ✂️ **Edit** | Trim, rotate, flip and mix background audio in one place with a frame-accurate timeline preview. |
| 🔄 **Rotate / Flip** | 0° / 90° / 180° / 270° plus horizontal / vertical flip. **Prefers metadata rotation (no re-encode, instant)** and falls back to re-encoding only when required. |
| 🎵 **Extract Audio** | Pull the audio track out of a video to aac / mp3 / wav / flac / opus, with an optional time range. |
| 🔗 **Merge** | Concatenate multiple clips in order. When every clip shares the same parameters it uses **stream copy (`-c copy`, instant)**; otherwise it re-encodes each clip to a unified profile first, auto-padding silence for clips without audio. |

### Highlights

- **Zero command line** — drag files (or whole folders, scanned recursively) into the window to build a queue.
- **Never degrades** — output resolution / bitrate will never exceed the source (hard cap rule).
- **Visible parameters** — every effective value (including auto-computed and capped values) is shown before you start.
- **Hardware acceleration** — auto-detects NVIDIA NVENC, Intel QuickSync, AMD AMF, macOS VideoToolbox and **Apple Silicon MPS**, with a software fallback.
- **Single config file** — one editable `config.json` next to the app.
- **10 languages** — zh-CN / zh-TW / ja / ko / en / fr / es / pt / de / it, with automatic system-language matching.

### Simple mode quality profile

Simple mode targets a single **1080p / 30fps** output and decides "no transcode needed" per codec. Both the no-transcode bitrate threshold and the encode CRF come from the **target codec**, scaled by resolution (**4K = ×4** the 1080p value):

| Target codec | CRF | 1080p30 threshold | 4K30 threshold |
|---|---|---|---|
| H.264 | 21 | 6.0 Mbps | 24.0 Mbps |
| H.265 | 26 | 4.0 Mbps | 16.0 Mbps |
| VP9 | 30 | 4.0 Mbps | 16.0 Mbps |
| AV1 | 33 | 2.8 Mbps | 11.2 Mbps |

- A source is skipped (`no-op`) only when resolution / frame rate / bitrate are all within budget.
- **Modern codecs (H.264 / H.265 / VP9 / AV1) are never re-encoded just because the format differs** — this avoids quality loss from repeated transcoding.
- **Legacy formats** (Xvid / MPEG-4 Part 2, MPEG-2, VC-1, VP8 …) or sources whose codec cannot be detected are always re-encoded to the target modern codec.
- `simpleMode.target.bitrateMbps` / `crf` remain available as optional manual overrides.

---

## 🚀 Getting Started (Development)

### Requirements

- Node.js 18+
- FFmpeg / FFprobe binaries available under `ffmpeg/bin` (or install them system-wide if you're on Windows)

> **FFmpeg / FFprobe**
> - **macOS:** install via Homebrew — `brew install ffmpeg`.
> - **Windows (building from source):** make sure the `ffmpeg/bin` folder contains **`ffprobe.exe`** and **`ffmpeg.exe`**.

### Install & run

```bash
npm install        # if the Electron download fails, set ELECTRON_MIRROR (see FAQ)
npm run dev        # start with HMR
```

### Build & package

```bash
npm run build      # compile main / preload / renderer
npm run dist       # build + package installers (NSIS on Windows, DMG on macOS)
npm run typecheck  # TypeScript check
npm test           # unit tests (vitest)
```

Packaged output goes to `release/`.

---

## ⚙️ Configuration

The app reads a single `config.json` from the app root directory (falling back to the user data directory when the root is not writable). It stores language, theme, output folder, transcode defaults, expert presets, hardware preferences and more.

```jsonc
{
  "version": "1.0",
  "language": "auto",      // "auto" follows the system language
  "theme": "system",       // "system" | "light" | "dark"
  "paths": { "outputDir": "" },
  "simpleMode": { "target": { "resolution": 1080, "fps": 30 } }  // bitrateMbps / crf = optional manual overrides
}
```

---

## ❓ FAQ

**The Electron download fails during `npm install` with `The server aborted pending request`.**
This is a network issue reaching GitHub Releases. Use a mirror:

```bash
ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ npm install
```

Or add a project-level `.npmrc`:

```ini
registry=https://registry.npmmirror.com/
electron_mirror=https://registry.npmmirror.com/-/binary/electron/
```

---

## 💖 Sponsor / Support

Echo Video Transcoder is free and open source. If it saves you time, consider supporting its development.

**PayPal:** [paypal.me/geniusjees](https://paypal.me/geniusjees)

**WeChat Pay / Alipay** — scan the QR code below:

| WeChat Pay | Alipay |
|---|---|
| <img src="src/renderer/assets/wechat.png" alt="WeChat Pay" width="230" /> | <img src="src/renderer/assets/alipay.jpg" alt="Alipay" width="230" /> |

> The same sponsorship information is also available inside the app on the **Sponsor** page.

### Disclaimer

Sponsorship is entirely voluntary and does not constitute a purchase of goods or services. It **does not** grant any commercial license, priority support, or feature entitlements, and is **non-refundable**. The software is provided "as is", without warranty of any kind, and the author is not liable for any damages arising from its use. Sponsorships do not influence product decisions or the open-source license.

---

## 📄 License

[MIT](LICENSE) © Echo Video Transcoder

---

## 🙏 Acknowledgements

- [FFmpeg](https://ffmpeg.org/) — the media engine
- [Electron](https://www.electronjs.org/), [React](https://react.dev/), [Vite](https://vitejs.dev/), [Tailwind CSS](https://tailwindcss.com/)
