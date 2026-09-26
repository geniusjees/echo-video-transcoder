import { BrowserWindow, Menu, app, nativeTheme, shell } from 'electron';
import path from 'node:path';
import { initConfig } from './config/configStore';
import { detectCached } from './hardware/detector';
import { registerAllIpc } from './ipc';
import { binStatus, binaryArchWarning, configPath } from './utils/paths';

const isDev = !app.isPackaged;

/** 缺失 ffmpeg 时建议的安装命令（按平台） */
function installCommand(): string {
  if (process.platform === 'darwin') return 'brew install ffmpeg';
  if (process.platform === 'win32') return 'winget install Gyan.FFmpeg';
  return 'sudo apt install ffmpeg';
}

/** 应用图标：打包后取 resources/icon.png，开发时取项目 build/icon.png */
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'icon.png')
  : path.join(__dirname, '../../build/icon.png');

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'Echo Video Transcoder',
    icon: appIconPath,
    // 隐藏 File / Edit 等原生菜单栏
    autoHideMenuBar: true,
    // 与主题一致，避免启动白/黑闪屏
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1117' : '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

async function bootstrap(): Promise<void> {
  // 去掉原生应用菜单（本工具不需要 File/Edit 等菜单）
  Menu.setApplicationMenu(null);

  // 单一配置初始化（C1/C2）：根目录不可写时自动 fallback（§5.2）
  const { warning } = initConfig();

  registerAllIpc();

  mainWindow = createWindow();

  mainWindow.webContents.once('did-finish-load', () => {
    if (warning) mainWindow?.webContents.send('log', `[配置] ${warning}`);

    // 环境自检：ffmpeg / ffprobe 解析状态
    const status = binStatus();
    mainWindow?.webContents.send('log', `[环境] ffmpeg: ${status.paths.ffmpeg}`);
    mainWindow?.webContents.send('log', `[环境] ffprobe: ${status.paths.ffprobe}`);
    mainWindow?.webContents.send('log', `[环境] config: ${configPath()}`);

    // 缺失必需二进制（ffmpeg / ffprobe）—— 否则核心功能不可用
    if (status.missing.length) {
      mainWindow?.webContents.send(
        'log',
          `[环境] ⚠ 未找到必需组件：${status.missing.join(' / ')}。请执行：${installCommand()}`
      );
    }

    const archWarn = binaryArchWarning(status.paths.ffmpeg);
    if (archWarn) mainWindow?.webContents.send('log', `[硬件] ⚠ ${archWarn}`);

    mainWindow?.webContents.send('app:env', {
      isDev,
      platform: process.platform,
      // 系统语言：渲染进程用它匹配 i18n 语言（C4 语言自动匹配）
      locale: app.getLocale(),
      configPath: configPath(),
      ffmpeg: status.paths.ffmpeg,
      ffprobe: status.paths.ffprobe,
      /** 缺失的二进制（渲染进程据此弹出提示框） */
      missingBins: status.missing,
      missingRequiredBins: status.missingRequired,
      /** 建议的安装命令（供一键复制） */
      installCommand: installCommand()
    });
  });

  // 启动即侦测显卡（C4）
  void detectCached(true).then((cap) => {
    mainWindow?.webContents.send('log', `[硬件] 侦测结果：${cap.recommended}${cap.mps ? '（Apple MPS）' : ''}`);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
}

void app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
