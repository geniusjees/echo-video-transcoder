import { useState } from 'react';
import DropZone from '../components/DropZone';
import OutputFolderPicker from '../components/OutputFolderPicker';
import CommandPreview from '../components/CommandPreview';
import SegmentList from '../components/concat/SegmentList';
import ConcatPlanSummary from '../components/concat/ConcatPlanSummary';
import { useConcatStore } from '../stores/concatStore';
import { useConfigStore } from '../stores/configStore';
import { useDropHandler } from '../hooks/useDropHandler';
import { useImportStore } from '../stores/importStore';
import { useQueueStore } from '../stores/queueStore';
import { useT } from '../i18n';
import { baseName } from '../utils/format';

/** 视频拼接页（§13.4）：纯拼接 / 转码对齐 + 音频统一（v4.1） */
export default function ConcatPage() {
  const t = useT();
  const config = useConfigStore((s) => s.config);
  const setOutputDirCfg = useConfigStore((s) => s.setOutputDir);

  const segments = useConcatStore((s) => s.segments);
  const plan = useConcatStore((s) => s.plan);
  const outputDir = useConcatStore((s) => s.outputDir);
  const outputName = useConcatStore((s) => s.outputName);
  const busy = useConcatStore((s) => s.busy);
  const loading = useConcatStore((s) => s.loading);
  const addFiles = useConcatStore((s) => s.addFiles);
  const remove = useConcatStore((s) => s.remove);
  const move = useConcatStore((s) => s.move);
  const setTrim = useConcatStore((s) => s.setTrim);
  const clear = useConcatStore((s) => s.clear);
  const setOutputDir = useConcatStore((s) => s.setOutputDir);
  const setOutputName = useConcatStore((s) => s.setOutputName);
  const start = useConcatStore((s) => s.start);

  const [showCommand, setShowCommand] = useState(false);

  // 窗口任意位置拖入片段（C9）
  useDropHandler((paths) => void addFiles(paths));

  const pickFolder = async () => {
    const dir = await window.api.selectFolder();
    if (!dir) return;
    const imp = useImportStore.getState();
    imp.begin('scan', '');
    try {
      const res = await window.api.expandPaths([dir]);
      if (!res.files.length) {
        useQueueStore.getState().onLog('[folder] no video file found');
        return;
      }
      imp.begin('probe', '', res.files.length);
      await addFiles(res.files);
    } finally {
      imp.finish();
    }
  };

  const changeOutputDir = async (dir: string) => {
    setOutputDir(dir);
    await setOutputDirCfg(dir);
  };

  const canStart = Boolean(outputDir) && Boolean(plan) && segments.length > 0 && !busy;

  return (
    <div className="grid grid-cols-[1fr_380px] gap-4">
      <div className="space-y-4">
        <DropZone onFiles={(paths) => void addFiles(paths)} hint={t('concat.dropHint')} />

        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={pickFolder}>
            {t('queue.addFolder')}
          </button>
          <button className="btn-ghost" onClick={clear} disabled={!segments.length}>
            {t('concat.clear')}
          </button>
          <span className="text-xs text-faint">
            {loading ? t('concat.probing') : t('concat.count', { n: segments.length })}
          </span>
        </div>

        <SegmentList
          segments={segments}
          onMove={move}
          onRemove={remove}
          onTrimChange={setTrim}
        />
      </div>

      <div className="space-y-4">
        <ConcatPlanSummary
          plan={plan}
          segments={segments.map((s) => ({ id: s.id, name: baseName(s.input) }))}
        />

        <OutputFolderPicker value={outputDir} onChange={changeOutputDir} required />

        <div className="card">
          <label className="label">{t('concat.outputName')}</label>
          <input
            className="input"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            placeholder={t('concat.outputNamePlaceholder')}
          />
        </div>

        <button className="btn-primary w-full" disabled={!canStart} onClick={() => void start()}>
          ▶ {t('concat.start')}
        </button>
        {!outputDir && <p className="text-xs text-warn">{t('op.needOutputDir')}</p>}

        {config?.advanced.showCommandPreview && (
          <CommandPreview
            commands={
              plan
                ? [
                    plan.strategy === 'copy'
                      ? `-f concat -safe 0 -i <list.txt> -c copy ${outputName}`
                      : `${t('concat.strategyTranscode')} (${plan.uniform.resolution}p/${plan.uniform.fps}fps/${plan.uniform.bitrateMbps}Mbps) → concat -c copy`
                  ]
                : []
            }
            open={showCommand}
            onToggle={() => setShowCommand((v) => !v)}
          />
        )}
      </div>
    </div>
  );
}
