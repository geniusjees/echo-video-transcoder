import { useState } from 'react';
import type { FlipMode, RotateMode, TaskPayload } from '@shared/types';
import OutputFolderPicker from '../components/OutputFolderPicker';
import QueueList from '../components/QueueList';
import SuffixOptions from '../components/SuffixOptions';
import { useConfigStore } from '../stores/configStore';
import { useQueueStore } from '../stores/queueStore';
import { useDropHandler } from '../hooks/useDropHandler';
import { useOutputNaming } from '../hooks/useOutputNaming';
import { useT } from '../i18n';
import { makeOutputPath, outputFileName } from '../utils/output';

/** 角度本身语言无关，仅「不旋转」需要本地化 */
const ROTATE_MODES: { v: RotateMode; label?: string; labelKey?: string }[] = [
  { v: 0, labelKey: 'rotate.none' },
  { v: 90, label: '90°' },
  { v: 180, label: '180°' },
  { v: 270, label: '270°' }
];

const FLIP_MODES: { v: FlipMode; labelKey: string }[] = [
  { v: 'none', labelKey: 'rotate.flipNone' },
  { v: 'horizontal', labelKey: 'rotate.flipHorizontal' },
  { v: 'vertical', labelKey: 'rotate.flipVertical' }
];

/** 旋转 / 翻转页：能用元数据旋转时自动使用（不重编码，§1.1-3） */
export default function RotatePage() {
  const t = useT();
  const config = useConfigStore((s) => s.config);
  const setOutputDirCfg = useConfigStore((s) => s.setOutputDir);
  const items = useQueueStore((s) => s.items);
  const progress = useQueueStore((s) => s.progress);
  const addFiles = useQueueStore((s) => s.addFiles);
  const remove = useQueueStore((s) => s.remove);
  const setOutputDirForAll = useQueueStore((s) => s.setOutputDirForAll);
  const start = useQueueStore((s) => s.start);
  const busy = useQueueStore((s) => s.busy);

  const [mode, setMode] = useState<RotateMode>(90);
  const [flip, setFlip] = useState<FlipMode>('none');

  const outputDir = config?.paths.outputDir ?? '';

  // ---- 输出命名设置（与转码 / 编辑页同一套逻辑，配置独立保存）----
  const {
    naming,
    appendSuffix,
    sameAsSource,
    suffixDraft,
    validation: suffixValidation,
    invalid: suffixInvalid,
    setAppendSuffix,
    setSameAsSource,
    onSuffixChange
  } = useOutputNaming('rotate');

  /** 「与原文件同一文件夹」时不需要选输出目录 */
  const hasOutput = sameAsSource || Boolean(outputDir);
  /** 输出文件名示例（如 clip_rotated.mp4） */
  const exampleName = outputFileName(items[0]?.input ?? 'video.mp4', 'mp4', 'rotate', naming);

  // 翻转必须重编码；仅旋转时由主进程按格式自动判断能否使用元数据
  const needReencode = flip !== 'none';

  // 窗口任意位置拖入均入队（C9）
  useDropHandler((paths) => void addFiles(paths));

  const pickFiles = async () => {
    const picked = await window.api.selectFiles();
    if (picked?.length) await addFiles(picked);
  };

  const pickFolder = async () => {
    const dir = await window.api.selectFolder();
    if (dir) await addFiles([dir]);
  };

  const changeOutputDir = async (dir: string) => {
    await setOutputDirCfg(dir);
    setOutputDirForAll(dir);
  };

  const onStart = async () => {
    await start({
      kind: 'rotate',
      filter: () => true,
      build: (item): TaskPayload => ({
        id: item.id,
        kind: 'rotate',
        input: item.input,
        // 始终按当前设置推导：同目录 / 自定义后缀 / 覆盖原文件都在 makeOutputPath 内处理
        output: makeOutputPath(item.input, outputDir, 'mp4', 'rotate', naming),
        durationSec: item.source.durationSec,
        // metadataOnly 恒为 true：能用元数据旋转就一定会用
        rotate: { mode, flip, metadataOnly: true }
      })
    });
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-4">
      <div className="min-w-0 space-y-4">
        <QueueList
          titleKey="queue.titleRotate"
          items={items}
          progress={progress}
          onRemove={remove}
          onAdd={pickFiles}
          onAddFolder={pickFolder}
        />
      </div>

      <div className="space-y-4">
        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-strong">{t('rotate.title')}</h3>
          <div className="grid grid-cols-4 gap-2">
            {ROTATE_MODES.map((r) => (
              <button
                key={r.v}
                className={mode === r.v ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setMode(r.v)}
              >
                {r.labelKey ? t(r.labelKey) : r.label}
              </button>
            ))}
          </div>

          <h3 className="text-sm font-semibold text-strong">{t('rotate.flip')}</h3>
          <div className="grid grid-cols-3 gap-2">
            {FLIP_MODES.map((f) => (
              <button
                key={f.v}
                className={flip === f.v ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setFlip(f.v)}
              >
                {t(f.labelKey)}
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-surface-600 bg-surface-700/60 px-3 py-2 text-xs leading-relaxed text-muted">
            {needReencode ? (
              <>
                ⚠ {t('rotate.reencodeBefore')}
                <strong className="text-warn">{t('rotate.reencodeStrong')}</strong>
                {t('rotate.reencodeAfter')}
              </>
            ) : (
              <>
                {t('rotate.metaBefore')}
                <strong className="text-accent">{t('rotate.metaStrong')}</strong>
                {t('rotate.metaAfter')}
              </>
            )}
          </div>
        </div>

        <OutputFolderPicker
          value={outputDir}
          onChange={changeOutputDir}
          required
          disabled={sameAsSource}
          showSameAsSource
          sameAsSource={sameAsSource}
          onSameAsSourceChange={setSameAsSource}
        />

        <SuffixOptions
          title={t('suffix.titleRotate')}
          checked={appendSuffix}
          onCheckedChange={setAppendSuffix}
          value={suffixDraft}
          onValueChange={onSuffixChange}
          validation={suffixValidation}
          sameAsSource={sameAsSource}
          example={exampleName}
        />

        {suffixInvalid && <p className="text-xs text-err">{t('op.invalidSuffix')}</p>}

        <button
          className="btn-primary w-full"
          disabled={!hasOutput || suffixInvalid || !items.length || busy}
          onClick={onStart}
        >
          ▶ {t('rotate.start')}
        </button>
      </div>
    </div>
  );
}
