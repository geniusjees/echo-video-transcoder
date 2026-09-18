import { useCallback, useEffect, useMemo, useState } from 'react';
import { decideExpert, resolveExpertParams } from '@shared/params';
import type { QueueItem, ResolvedParams, TaskPayload } from '@shared/types';
import QueueList from '../components/QueueList';
import CommandPreview from '../components/CommandPreview';
import OutputFolderPicker from '../components/OutputFolderPicker';
import SimpleMode from '../components/mode/SimpleMode';
import ExpertMode from '../components/mode/ExpertMode';
import { useDropHandler } from '../hooks/useDropHandler';
import { useConfigStore } from '../stores/configStore';
import { useImportStore } from '../stores/importStore';
import { useQueueStore } from '../stores/queueStore';
import { useParamStore } from '../stores/paramStore';
import { useUiStore } from '../stores/uiStore';
import { useT } from '../i18n';
import { makeOutputPath } from '../utils/output';

/**
 * 转码页布局：
 * 左 = 转码队列（自适应高度，超出内部滚动，也是拖拽落点）
 * 右 = 输出文件夹 → 操作（含日志开关）→ 模式选择 → 模式面板 → 命令预览
 *
 * 专家参数在渲染进程用纯函数同步推导（@shared/params），
 * 因此模式切换 / 参数改动会立刻反映到列表中的参数行与体积预估。
 */
export default function TranscodePage() {
  const t = useT();
  const config = useConfigStore((s) => s.config);
  const hardware = useConfigStore((s) => s.hardware);
  const setOutputDirCfg = useConfigStore((s) => s.setOutputDir);

  const items = useQueueStore((s) => s.items);
  const progress = useQueueStore((s) => s.progress);
  const addFiles = useQueueStore((s) => s.addFiles);
  const remove = useQueueStore((s) => s.remove);
  const clear = useQueueStore((s) => s.clear);
  const setItems = useQueueStore((s) => s.setItems);
  const setOutputDirForAll = useQueueStore((s) => s.setOutputDirForAll);
  const start = useQueueStore((s) => s.start);
  const cancel = useQueueStore((s) => s.cancel);
  const busy = useQueueStore((s) => s.busy);
  const onLog = useQueueStore((s) => s.onLog);

  const mode = useParamStore((s) => s.mode);
  const setMode = useParamStore((s) => s.setMode);
  const scaleResolution = useParamStore((s) => s.scaleResolution);
  const setScaleResolution = useParamStore((s) => s.setScaleResolution);
  const expertOptions = useParamStore((s) => s.expertOptions);
  const setExpertOptions = useParamStore((s) => s.setExpertOptions);
  const showCommand = useParamStore((s) => s.showCommand);
  const toggleCommand = useParamStore((s) => s.toggleCommand);
  const setLogOpen = useUiStore((s) => s.setLogOpen);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [command, setCommand] = useState('');

  const outputDir = config?.paths.outputDir ?? '';
  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? items[0] ?? null,
    [items, selectedId]
  );

  /** 专家模式下每个条目的生效参数（同步推导，随参数实时变化） */
  const expertParams = useMemo(() => {
    const map: Record<string, ResolvedParams> = {};
    if (mode !== 'expert') return map;
    for (const item of items) {
      if (item.status === 'error') continue;
      map[item.id] = resolveExpertParams(item.source, expertOptions, hardware ?? undefined);
    }
    return map;
  }, [mode, items, expertOptions, hardware]);

  /** 当前模式下真正生效的参数 */
  const effectiveFor = useCallback(
    (item: QueueItem): ResolvedParams | null =>
      mode === 'expert' ? (expertParams[item.id] ?? item.resolved) : item.resolved,
    [mode, expertParams]
  );

  const handleFiles = useCallback(
    async (paths: string[]) => {
      try {
        const added = await addFiles(paths, {
          scaleResolution,
          expert: expertOptions,
          mode
        });
        if (added.length && !selectedId) setSelectedId(added[0].id);
      } catch (e) {
        onLog(`[drop] failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [addFiles, scaleResolution, expertOptions, mode, selectedId, onLog]
  );

  // 窗口任意位置拖入均入队（C9）
  useDropHandler(handleFiles);

  const pickFiles = useCallback(async () => {
    const paths = await window.api.selectFiles();
    if (paths?.length) await handleFiles(paths);
  }, [handleFiles]);

  /** 文件夹导入：递归遍历所有子文件夹（带进度条） */
  const pickFolder = useCallback(async () => {
    const dir = await window.api.selectFolder();
    if (!dir) return;
    const imp = useImportStore.getState();
    imp.begin('scan', '');
    try {
      onLog(`[folder] scanning ${dir} ...`);
      const res = await window.api.expandPaths([dir]);
      if (!res.files.length) {
        onLog('[folder] no video file found');
        return;
      }
      onLog(`[folder] ${res.folders} subfolders, ${res.files.length} videos`);
      imp.begin('probe', '', res.files.length);
      await handleFiles(res.files);
    } catch (e) {
      onLog(`[folder] import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      imp.finish();
    }
  }, [handleFiles, onLog]);

  const changeOutputDir = async (dir: string) => {
    await setOutputDirCfg(dir);
    setOutputDirForAll(dir);
  };

  // 普通模式：分辨率开关变化 → 重新走决策树（§7）
  const refreshDecisions = useCallback(
    async (scale: boolean) => {
      if (mode !== 'simple' || !items.length) return;
      const next = await Promise.all(
        items.map(async (it) => {
          if (it.status === 'error') return it;
          const d = await window.api.simpleDecide({ source: it.source, scaleResolution: scale });
          const out = d.params
            ? makeOutputPath(it.input, outputDir, d.params.container, 'transcode')
            : '';
          return {
            ...it,
            scaleResolution: scale,
            decision: d,
            resolved: d.params,
            output: out,
            status:
              d.action === 'no-op'
                ? ('skipped' as const)
                : it.status === 'done' || it.status === 'running'
                  ? it.status
                  : ('pending' as const)
          };
        })
      );
      const changed = next.some(
        (item, index) =>
          item.decision.action !== items[index].decision.action ||
          item.status !== items[index].status ||
          item.output !== items[index].output ||
          item.resolved !== items[index].resolved
      );
      if (changed) setItems(next);
    },
    [items, mode, outputDir, setItems]
  );

  const refreshExpertDecisions = useCallback(() => {
    if (mode !== 'expert' || !items.length) return;
    const next = items.map((it) => {
      if (it.status === 'error') return it;
      const d = decideExpert(it.source, expertOptions, hardware ?? undefined);
      const out = d.params ? makeOutputPath(it.input, it.outputDir, d.params.container, 'transcode') : '';
      return {
        ...it,
        decision: d,
        resolved: d.params,
        output: out,
        status:
          d.action === 'no-op'
            ? ('skipped' as const)
            : it.status === 'done' || it.status === 'running'
              ? it.status
              : ('pending' as const)
      };
    });
    const changed = next.some(
      (item, index) =>
        item.decision.action !== items[index].decision.action ||
        item.status !== items[index].status ||
        item.output !== items[index].output ||
        item.resolved !== items[index].resolved
    );
    if (changed) setItems(next);
  }, [expertOptions, hardware, items, mode, setItems]);

  useEffect(() => {
    if (mode === 'simple') {
      void refreshDecisions(scaleResolution);
    } else {
      refreshExpertDecisions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleResolution, mode, expertOptions, hardware]);

  // 命令预览（C7）
  useEffect(() => {
    if (!selected || !outputDir || selected.status === 'error') {
      setCommand('');
      return;
    }
    const params = effectiveFor(selected);
    if (!params) {
      setCommand('');
      return;
    }
    const payload: TaskPayload = {
      id: selected.id,
      kind: 'transcode',
      input: selected.input,
      output: makeOutputPath(selected.input, outputDir, params.container, 'transcode'),
      durationSec: selected.source.durationSec,
      params
    };
    let alive = true;
    void window.api.buildCommand({ payload, source: selected.source }).then((res) => {
      if (alive) setCommand(res.command ?? '');
    });
    return () => {
      alive = false;
    };
  }, [selected, outputDir, effectiveFor]);

  const canStart = Boolean(outputDir) && items.some((i) => Boolean(effectiveFor(i))) && !busy;

  const onStart = async () => {
    await start({
      kind: 'transcode',
      filter: (i) => Boolean(effectiveFor(i)) && i.status !== 'done',
      build: (item) => {
        const p = effectiveFor(item) ?? item.resolved!;
        return {
          id: item.id,
          kind: 'transcode' as const,
          input: item.input,
          output:
            item.output || makeOutputPath(item.input, item.outputDir, p.container, 'transcode'),
          durationSec: item.source.durationSec,
          params: p
        };
      }
    });
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_440px] gap-4">
      {/* 左：队列（自适应高度，超出滚动） */}
      <QueueList
        variant="fill"
        items={items}
        progress={progress}
        onRemove={remove}
        onClear={clear}
        onAdd={pickFiles}
        onAddFolder={pickFolder}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        mode={mode}
        expertResolved={expertParams}
      />

      {/* 右：设置 + 操作（自身可滚动） */}
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <OutputFolderPicker value={outputDir} onChange={changeOutputDir} required />

        <div className="card space-y-2">
          <h3 className="text-sm font-semibold text-strong">{t('op.title')}</h3>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!canStart} onClick={onStart}>
              ▶ {t('op.start')}
            </button>
            <button className="btn-ghost" disabled={!busy} onClick={() => cancel()}>
              ■ {t('op.cancel')}
            </button>
            <button className="btn-ghost" onClick={() => setLogOpen(true)}>
              {t('op.log')}
            </button>
          </div>
          {!outputDir && <p className="text-xs text-warn">{t('op.needOutputDir')}</p>}
          {outputDir && !items.some((i) => Boolean(effectiveFor(i))) && (
            <p className="text-xs text-faint">{t('op.nothing')}</p>
          )}
        </div>

        {/* 模式选择（位于操作下方） */}
        <div className="card">
          <div className="grid grid-cols-2 gap-2">
            {(['simple', 'expert'] as const).map((m) => (
              <button
                key={m}
                className={mode === m ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setMode(m)}
              >
                {m === 'simple' ? `🟢 ${t('mode.simple')}` : `🔵 ${t('mode.expert')}`}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-faint">
            {t('mode.current')}
            {mode === 'simple' ? t('mode.simpleDesc') : t('mode.expertDesc')}
          </p>
        </div>

        {mode === 'simple' ? (
          <SimpleMode
            selected={selected}
            scaleResolution={scaleResolution}
            onScaleChange={setScaleResolution}
            target={config?.simpleMode.target ?? { resolution: 1080, fps: 30, bitrateMbps: 6, crf: 28 }}
          />
        ) : (
          <ExpertMode
            hardware={hardware}
            options={expertOptions}
            resolved={selected ? (expertParams[selected.id] ?? null) : null}
            onChange={setExpertOptions}
          />
        )}

        {config?.advanced.showCommandPreview && (
          <CommandPreview command={command} open={showCommand} onToggle={toggleCommand} />
        )}
      </div>
    </div>
  );
}
