import { useCallback, useEffect, useMemo, useState } from 'react';
import { decideExpert, resolveExpertParams } from '@shared/params';
import type { QueueItem, ResolvedParams, TaskPayload } from '@shared/types';
import QueueList from '../components/QueueList';
import CommandPreview from '../components/CommandPreview';
import OutputFolderPicker from '../components/OutputFolderPicker';
import SuffixOptions from '../components/SuffixOptions';
import SimpleMode from '../components/mode/SimpleMode';
import ExpertMode from '../components/mode/ExpertMode';
import { useDropHandler } from '../hooks/useDropHandler';
import { useOutputNaming } from '../hooks/useOutputNaming';
import { useConfigStore } from '../stores/configStore';
import { useImportStore } from '../stores/importStore';
import { useQueueStore } from '../stores/queueStore';
import { useParamStore } from '../stores/paramStore';
import { useUiStore } from '../stores/uiStore';
import { useT } from '../i18n';
import { makeOutputPath, outputFileName } from '../utils/output';

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

  // ---- 输出命名设置（自定义后缀 / 与原文件同一文件夹）----
  // 与编辑页共用同一套逻辑（useOutputNaming），但两页各自独立保存
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
  } = useOutputNaming('transcode');

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

  /** 输出文件名示例（如 clip_out.mp4） */
  const exampleName = useMemo(() => {
    const params = selected ? effectiveFor(selected) : null;
    const ext = params?.container ?? 'mp4';
    return outputFileName(selected?.input ?? 'video.mp4', ext, 'transcode', naming);
  }, [selected, effectiveFor, naming]);

  const handleFiles = useCallback(
    async (paths: string[]) => {
      try {
        const added = await addFiles(paths, {
          scaleResolution,
          expert: expertOptions,
          mode,
          naming
        });
        if (added.length && !selectedId) setSelectedId(added[0].id);
      } catch (e) {
        onLog(`[drop] failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [addFiles, scaleResolution, expertOptions, mode, naming, selectedId, onLog]
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
    setOutputDirForAll(dir, naming);
  };

  // 输出目录/命名规则以配置为唯一事实来源：变化后（含从磁盘加载 / 其它页改动）
  // 同步到已入队条目，避免「改了设置但队列仍用旧路径」。
  useEffect(() => {
    setOutputDirForAll(outputDir, naming);
  }, [outputDir, naming, setOutputDirForAll]);

  // 普通模式：分辨率开关变化 → 重新走决策树（§7）
  const refreshDecisions = useCallback(
    async (scale: boolean) => {
      if (mode !== 'simple' || !items.length) return;
      const next = await Promise.all(
        items.map(async (it) => {
          if (it.status === 'error') return it;
          const d = await window.api.simpleDecide({ source: it.source, scaleResolution: scale });
          const out = d.params
            ? makeOutputPath(it.input, outputDir, d.params.container, 'transcode', naming)
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
    [items, mode, outputDir, naming, setItems]
  );

  const refreshExpertDecisions = useCallback(() => {
    if (mode !== 'expert' || !items.length) return;
    const next = items.map((it) => {
      if (it.status === 'error') return it;
      const d = decideExpert(it.source, expertOptions, hardware ?? undefined);
      const out = d.params
        ? makeOutputPath(it.input, outputDir, d.params.container, 'transcode', naming)
        : '';
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
  }, [expertOptions, hardware, items, mode, outputDir, naming, setItems]);

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
    if (!selected || (!outputDir && !sameAsSource) || selected.status === 'error') {
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
      output: makeOutputPath(selected.input, outputDir, params.container, 'transcode', naming),
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
  }, [selected, outputDir, sameAsSource, naming, effectiveFor]);

  const hasOutput = sameAsSource || Boolean(outputDir);
  const canStart =
    hasOutput && !suffixInvalid && items.some((i) => Boolean(effectiveFor(i))) && !busy;

  const onStart = async () => {
    // 以「点击瞬间」的 store 状态推导参数，不依赖上一帧的 memo：
    // 刚改完码率/CRF 就点开始时，能确保用的是最新值而不是旧参数。
    const { expertOptions: liveOpts, mode: liveMode } = useParamStore.getState();
    const paramsAtClick = (item: QueueItem) =>
      liveMode === 'expert'
        ? resolveExpertParams(item.source, liveOpts, hardware ?? undefined)
        : effectiveFor(item);

    await start({
      kind: 'transcode',
      filter: (i) => Boolean(paramsAtClick(i)) && i.status !== 'done',
      build: (item) => {
        const p = paramsAtClick(item) ?? item.resolved!;
        return {
          id: item.id,
          kind: 'transcode' as const,
          input: item.input,
          // 始终按「当前」输出目录与命名规则推导，不依赖入队时缓存的 item.output，
          // 否则改目录后仍会写到拖入文件前的旧目录。
          output: makeOutputPath(item.input, outputDir, p.container, 'transcode', naming),
          durationSec: item.source.durationSec,
          params: p
        };
      }
    });
  };

  return (
    // 左列 minmax(0,1fr)：可收缩到 0，超长文件名不会把右侧固定宽度面板挤走
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_440px] gap-4">
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
      <div className="min-h-0 min-w-0 space-y-4 overflow-y-auto pr-1">
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
          checked={appendSuffix}
          onCheckedChange={setAppendSuffix}
          value={suffixDraft}
          onValueChange={onSuffixChange}
          validation={suffixValidation}
          sameAsSource={sameAsSource}
          example={exampleName}
        />

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
          {!hasOutput && <p className="text-xs text-warn">{t('op.needOutputDir')}</p>}
          {suffixInvalid && <p className="text-xs text-err">{t('op.invalidSuffix')}</p>}
          {hasOutput && !items.some((i) => Boolean(effectiveFor(i))) && (
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
            target={config?.simpleMode.target ?? { resolution: 1080, fps: 30, crf: 26 }}
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
