import { useEffect, useState } from 'react';
import appIcon from './assets/icon.png';
import HardwareBadge from './components/HardwareBadge';
import ImportProgress from './components/ImportProgress';
import LanguageSwitch from './components/LanguageSwitch';
import LogModal from './components/LogModal';
import MessageDialog from './components/MessageDialog';
import MissingBinsModal from './components/MissingBinsModal';
import ThemeSwitch from './components/ThemeSwitch';
import ConcatPage from './pages/ConcatPage';
import EditPage from './pages/EditPage';
import ExtractAudioPage from './pages/ExtractAudioPage';
import RotatePage from './pages/RotatePage';
import SponsorPage from './pages/SponsorPage';
import TranscodePage from './pages/TranscodePage';
import { t as translate, useT, useI18nStore } from './i18n';
import { useConfigStore } from './stores/configStore';
import { showConfirm } from './stores/dialogStore';
import { useConcatStore } from './stores/concatStore';
import { useDropStore } from './stores/dropStore';
import { useImportStore } from './stores/importStore';
import { shouldPromptClearQueue, useQueueStore } from './stores/queueStore';
import { useParamStore } from './stores/paramStore';
import { initTheme, type ThemeMode } from './stores/themeStore';
import { useUiStore } from './stores/uiStore';
import { dragHasFiles, resolveDroppedPaths } from './utils/files';

const TABS = ['transcode', 'edit', 'rotate', 'audio', 'concat', 'sponsor'] as const;
type TabKey = (typeof TABS)[number];

export default function App() {
  const t = useT();
  const [tab, setTab] = useState<TabKey>('transcode');
  const [systemLocale, setSystemLocale] = useState('');

  const config = useConfigStore((s) => s.config);
  const hardware = useConfigStore((s) => s.hardware);
  const notice = useConfigStore((s) => s.notice);
  const loadConfig = useConfigStore((s) => s.load);
  const detect = useConfigStore((s) => s.detect);
  const patchConfig = useConfigStore((s) => s.patch);
  const setNotice = useConfigStore((s) => s.setNotice);

  const onProgress = useQueueStore((s) => s.onProgress);
  const onLog = useQueueStore((s) => s.onLog);
  const onStatus = useQueueStore((s) => s.onStatus);

  const initFromConfig = useParamStore((s) => s.initFromConfig);
  const setConcatOutputDir = useConcatStore((s) => s.setOutputDir);
  const notifyMissingBins = useUiStore((s) => s.notifyMissingBins);

  const dragging = useDropStore((s) => s.dragging);
  const setDragging = useDropStore((s) => s.setDragging);

  useEffect(() => {
    void (async () => {
      // 配置与硬件侦测相互独立：任一失败都不应阻断另一项，且失败要可见
      try {
        await loadConfig();
      } catch (e) {
        useQueueStore.getState().onLog(`[配置] 加载失败：${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        await detect();
      } catch (e) {
        useQueueStore
          .getState()
          .onLog(`[硬件] 侦测失败：${e instanceof Error ? e.message : String(e)}（可点击右上角徽标重试）`);
      }
    })();
  }, [loadConfig, detect]);

  // 系统语言（主进程 app.getLocale()）+ 启动自检
  useEffect(() => {
    const off = window.api.onAppEnv((env) => {
      const payload = env as {
        locale?: string;
        platform?: string;
        missingRequiredBins?: string[];
        installCommand?: string;
      } | null;
      if (payload?.locale) setSystemLocale(payload.locale);
      // macOS 启动自检：缺失 ffmpeg / ffprobe 时弹出提示框（含一键复制安装命令）
      if (payload?.platform === 'darwin' && payload.missingRequiredBins?.length) {
        notifyMissingBins(payload.missingRequiredBins, payload.installCommand ?? '');
      }
    });
    return () => {
      off();
    };
  }, [notifyMissingBins]);

  // 语言初始化：系统语言匹配 + 用户配置（'auto' = 跟随系统）
  useEffect(() => {
    useI18nStore
      .getState()
      .init(systemLocale || navigator.language || 'en', config?.language ?? 'auto');
  }, [systemLocale, config?.language]);

  useEffect(() => {
    if (config) {
      initFromConfig(config, config.simpleMode.scaleResolution);
      initTheme((config.theme ?? 'system') as ThemeMode);
      if (config.paths.outputDir) setConcatOutputDir(config.paths.outputDir);
    }
  }, [config, initFromConfig, setConcatOutputDir]);

  // 订阅主进程事件
  useEffect(() => {
    const offP = window.api.onProgress(onProgress);
    const offL = window.api.onLog(onLog);
    const offS = window.api.onTaskStatus((p) => {
      onStatus(p);

      const items = useQueueStore.getState().items;
      if (shouldPromptClearQueue(items)) {
        // 注意：这里必须用模块级 t（调用时读取当前语言）。
        // 事件订阅 effect 只在挂载时执行一次，若用 useT() 的返回值会被闭包
        // 捕获成首帧语言（i18n store 初值为 zh-CN），导致界面切到日语仍弹中文。
        void showConfirm(
          translate('queue.clearCompletedConfirm'),
          translate('queue.clear')
        ).then((confirmed) => {
          if (confirmed) {
            useQueueStore.getState().clear();
          }
        });
      }

      if (p.id.startsWith('concat-') && (p.status === 'done' || p.status === 'error')) {
        useConcatStore.setState({ busy: false });
      }
    });
    const offI = window.api.onImportProgress((p) => useImportStore.getState().apply(p));
    return () => {
      offP();
      offL();
      offS();
      offI();
    };
  }, [onProgress, onLog, onStatus]);

  // 顶部提示 3.5 秒后自动消失
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  // 窗口级拖拽入队（C9）：拖到窗口任意位置都生效
  useEffect(() => {
    let depth = 0;

    const onDragEnter = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth += 1;
      if (!useDropStore.getState().dragging) setDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };

    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);

      const { paths, total, failed } = resolveDroppedPaths(e.dataTransfer);
      onLog(`[drop] ${total} → ${paths.length}`);
      if (failed.length) onLog(`[drop] unresolved: ${failed.join(', ')}`);

      const handler = useDropStore.getState().handler;
      if (!paths.length || !handler) return;
      handler(paths);
    };

    const guard = (e: DragEvent) => {
      if (!dragHasFiles(e)) e.preventDefault();
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    document.addEventListener('dragover', guard);
    document.addEventListener('drop', guard);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      document.removeEventListener('dragover', guard);
      document.removeEventListener('drop', guard);
    };
  }, [onLog, setDragging]);

  return (
    <div className="relative flex h-full flex-col">
      {/* 拖拽全屏提示 */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[9998] flex items-center justify-center bg-brand-500/10">
          <div className="rounded-2xl border-2 border-dashed border-brand-500 bg-surface-800/95 px-8 py-6 text-center shadow-2xl">
            <div className="text-3xl">⬇</div>
            <p className="mt-1.5 text-sm font-medium text-strong">{t('drop.overlayTitle')}</p>
            <p className="mt-0.5 text-xs text-muted">{t('drop.overlayHint')}</p>
          </div>
        </div>
      )}

      <LogModal />
      <MissingBinsModal />
      <MessageDialog />
      <ImportProgress />

      {/* 顶部栏 */}
      <header className="flex shrink-0 items-center justify-between border-b border-surface-600 bg-surface-800 px-5 py-3">
        <div className="flex items-center gap-2">
          <img
            src={appIcon}
            alt=""
            draggable={false}
            className="h-6 w-6 rounded object-contain"
          />
          <span className="text-sm font-semibold tracking-wide text-strong">{t('app.name')}</span>
        </div>

        <div className="flex items-center gap-3">
          <HardwareBadge capability={hardware} />
          <ThemeSwitch onChange={(mode) => void patchConfig({ theme: mode })} />
          <LanguageSwitch onChange={(language) => void patchConfig({ language })} />
        </div>
      </header>

      {/* Tab */}
      <nav className="flex shrink-0 gap-1 border-b border-surface-600 bg-surface-800/60 px-5">
        {TABS.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2.5 text-sm transition-colors ${
              tab === key
                ? 'border-brand-500 text-accent'
                : 'border-transparent text-muted hover:text-body'
            }`}
          >
            {t(`nav.${key}`)}
          </button>
        ))}
      </nav>

      {/* 内容 */}
      <main className="min-h-0 flex-1 overflow-auto p-5">
        {notice && (
          <div className="mb-4 rounded-lg border border-warnline bg-warn-bg px-4 py-2 text-xs text-warn">
            {notice}
          </div>
        )}
        {tab === 'transcode' && <TranscodePage />}
        {tab === 'edit' && <EditPage />}
        {tab === 'rotate' && <RotatePage />}
        {tab === 'audio' && <ExtractAudioPage />}
        {tab === 'concat' && <ConcatPage />}
        {tab === 'sponsor' && <SponsorPage />}
      </main>
    </div>
  );
}
