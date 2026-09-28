import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditCutSegment, FlipMode, RotateMode, TaskPayload } from '@shared/types';
import OutputFolderPicker from '../components/OutputFolderPicker';
import { useConfigStore } from '../stores/configStore';
import { useQueueStore } from '../stores/queueStore';
import { showAlert } from '../stores/dialogStore';
import { useDropHandler } from '../hooks/useDropHandler';
import { useT } from '../i18n';
import { createHoldController } from '../utils/editHold';
import { makeOutputPath } from '../utils/output';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function EditPage() {
  const t = useT();

  const ROTATE_OPTIONS: { v: RotateMode; label: string }[] = [
    { v: 0, label: '0°' },
    { v: 90, label: '90°' },
    { v: 180, label: '180°' },
    { v: 270, label: '270°' }
  ];

  const FLIP_OPTIONS: { v: FlipMode; label: string }[] = [
    { v: 'none', label: t('edit.flip.none') },
    { v: 'horizontal', label: t('edit.flip.horizontal') },
    { v: 'vertical', label: t('edit.flip.vertical') }
  ];
  const config = useConfigStore((s) => s.config);
  const setOutputDirCfg = useConfigStore((s) => s.setOutputDir);
  const items = useQueueStore((s) => s.items);
  const addFiles = useQueueStore((s) => s.addFiles);
  const setOutputDirForAll = useQueueStore((s) => s.setOutputDirForAll);
  const start = useQueueStore((s) => s.start);
  const busy = useQueueStore((s) => s.busy);
  const setNotice = useConfigStore((s) => s.setNotice);

  const [subMenu, setSubMenu] = useState<'trim' | 'rotate' | 'transcode' | null>('trim');
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [cutSegments, setCutSegments] = useState<EditCutSegment[]>([]);
  const [rotationMode, setRotationMode] = useState<RotateMode>(0);
  const [flipMode, setFlipMode] = useState<FlipMode>('none');
  const [transcodeEnabled, setTranscodeEnabled] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queueItem = useQueueStore((s) => (selectedId ? s.items.find((item) => item.id === selectedId) ?? null : null));
  const itemProgress = useQueueStore((s) => (selectedId ? s.progress[selectedId] : undefined));
  const [previewFrame, setPreviewFrame] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [videoMode, setVideoMode] = useState<'frame' | 'html-video'>('frame');
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const thumbnailTokenRef = useRef(0);
  const latestPreviewSeekRef = useRef(0);

  const outputDir = config?.paths.outputDir ?? '';
  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? items[0] ?? null, [items, selectedId]);
  const duration = selected?.source.durationSec || 0;
  const fps = selected?.source.fps || 30;
  const frameStep = 1 / Math.max(fps, 1);
  const stepHoldRef = useRef<ReturnType<typeof createHoldController> | null>(null);
  const editDoneNotifiedRef = useRef<string | null>(null);
  const editProgressVisible = Boolean(selected && queueItem && (queueItem.status === 'pending' || queueItem.status === 'running'));
  const editProgress = itemProgress?.percent ?? 0;

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setTrimStart(0);
    setTrimEnd(selected.source.durationSec || 0);
    setCurrentTime(0);
    setPreviewFrame('');
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) return;

    const seek = Math.min(currentTime, Math.max(duration, 0)) || 0;
    latestPreviewSeekRef.current = seek;

    const timer = window.setTimeout(() => {
      const token = ++thumbnailTokenRef.current;
      setPreviewLoading(true);

      void (async () => {
        try {
          const frame = await window.api.thumbnail(selected.input, seek, {
            mode: rotationMode,
            flip: flipMode
          });
          if (seek !== latestPreviewSeekRef.current || token !== thumbnailTokenRef.current) return;
          setPreviewFrame(frame || '');
        } finally {
          if (seek === latestPreviewSeekRef.current && token === thumbnailTokenRef.current) {
            setPreviewLoading(false);
          }
        }
      })();
    }, scrubbing ? 40 : 90);

    return () => {
      window.clearTimeout(timer);
    };
  }, [selected, currentTime, duration, rotationMode, flipMode, scrubbing]);

  useEffect(() => {
    if (!selected || videoMode !== 'html-video') return;
    const video = previewVideoRef.current;
    if (!video) return;
    video.src = selected.input;
    video.currentTime = currentTime;
    video.playbackRate = 1;
    if (playing) {
      void video.play().catch(() => setVideoMode('frame'));
    } else {
      video.pause();
    }
  }, [selected, currentTime, playing, videoMode]);

  useEffect(() => {
    if (!selected || !playing) return;

    const playbackStep = Math.max(frameStep, 0.2);
    const intervalMs = 150;

    const interval = window.setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + playbackStep;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [duration, frameStep, playing, selected]);

  useEffect(() => {
    const controller = createHoldController({
      intervalMs: 80,
      onStep: (direction) => {
        setCurrentTime((prev) => clamp(prev + direction * frameStep, 0, duration));
      }
    });
    stepHoldRef.current = controller;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!selected || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      controller.start(event.key === 'ArrowRight' ? 1 : -1);
    };
    const onKeyUp = () => {
      controller.stop();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      controller.stop();
    };
  }, [duration, frameStep, selected]);

  useEffect(() => {
    if (!selected || !queueItem || queueItem.id !== selected.id) return;
    if (queueItem.status === 'done' && editDoneNotifiedRef.current !== queueItem.id) {
      editDoneNotifiedRef.current = queueItem.id;
      setNotice(t('edit.completed'));
      void showAlert(t('edit.completed'));
    }
    if (queueItem.status === 'pending' || queueItem.status === 'running') {
      editDoneNotifiedRef.current = null;
    }
  }, [queueItem, selected, setNotice, t]);

  const handlePlayToggle = () => {
    if (!selected) return;
    setPlaying((prev) => {
      const next = !prev;
      if (next && currentTime >= duration) {
        setCurrentTime(0);
      }
      return next;
    });
  };

  const handleAddFiles = async (paths: string[]) => {
    if (!paths.length) return;
    useQueueStore.getState().clear();
    const nextItems = await addFiles(paths.slice(0, 1));
    const nextItem = nextItems[0];
    if (nextItem) {
      setSelectedId(nextItem.id);
      setCurrentTime(0);
      setPreviewFrame('');
      setPlaying(false);
    }
  };

  useDropHandler(async (paths) => {
    await handleAddFiles(paths);
  });

  const pickFiles = async () => {
    const picked = await window.api.selectFiles();
    if (picked?.length) {
      await handleAddFiles(picked);
    }
  };

  const pickFolder = async () => {
    const dir = await window.api.selectFolder();
    if (!dir) return;
    const res = await window.api.expandPaths([dir]);
    const first = res.files[0];
    if (!first) return;
    await handleAddFiles([first]);
  };

  const changeOutputDir = async (dir: string) => {
    await setOutputDirCfg(dir);
    setOutputDirForAll(dir);
  };

  const summary = useMemo(() => {
    const changes: string[] = [];
    if (rotationMode !== 0 || flipMode !== 'none') changes.push(t('edit.summary.rotate'));
    if (transcodeEnabled) changes.push(t('edit.summary.transcode'));
    if (cutSegments.length > 0) changes.push(t('edit.summary.trim'));
    return changes;
  }, [cutSegments.length, duration, flipMode, rotationMode, t, transcodeEnabled]);

  const trimSelectionVisible = trimStart !== trimEnd && trimEnd > trimStart && duration > 0;

  const timelineSegments = [
    ...cutSegments.map((seg) => ({ start: seg.startSec / Math.max(duration, 1), end: seg.endSec / Math.max(duration, 1), kind: 'cut' as const })),
    ...(trimSelectionVisible ? [{ start: trimStart / Math.max(duration, 1), end: trimEnd / Math.max(duration, 1), kind: 'trim' as const }] : [])
  ];

  const setTrimStartAtCurrent = () => {
    const nextStart = Math.max(0, currentTime - frameStep);
    setTrimStart(Math.min(nextStart, trimEnd));
  };

  const setTrimEndAtCurrent = () => {
    const nextEnd = Math.min(duration, currentTime + frameStep);
    setTrimEnd(Math.max(nextEnd, trimStart));
  };

  const trimBarRef = useRef<HTMLDivElement | null>(null);
  const trimDragRef = useRef<{ mode: 'start' | 'end' | 'move'; startPointerSec: number; startTrimStart: number; startTrimEnd: number } | null>(null);

  const beginTrimDrag = (mode: 'start' | 'end' | 'move', clientX: number) => {
    if (!trimBarRef.current) return;
    const rect = trimBarRef.current.getBoundingClientRect();
    const startPointerSec = ((clientX - rect.left) / Math.max(rect.width, 1)) * duration;
    trimDragRef.current = { mode, startPointerSec, startTrimStart: trimStart, startTrimEnd: trimEnd };
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!trimBarRef.current || !trimDragRef.current) return;
      const rect = trimBarRef.current.getBoundingClientRect();
      const nextPointerSec = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * duration;
      const { mode, startPointerSec, startTrimStart, startTrimEnd } = trimDragRef.current;
      const delta = nextPointerSec - startPointerSec;

      if (mode === 'start') {
        setTrimStart(clamp(startTrimStart + delta, 0, trimEnd));
        return;
      }
      if (mode === 'end') {
        setTrimEnd(clamp(startTrimEnd + delta, trimStart, duration));
        return;
      }

      const selectionWidth = startTrimEnd - startTrimStart;
      const nextStart = clamp(startTrimStart + delta, 0, Math.max(duration - selectionWidth, 0));
      const nextEnd = nextStart + selectionWidth;
      setTrimStart(nextStart);
      setTrimEnd(nextEnd);
    };

    const onUp = () => {
      trimDragRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [duration, trimEnd, trimStart]);

  const onStart = async () => {
    if (!selected) return;
    editDoneNotifiedRef.current = null;
    await start({
      kind: 'edit',
      filter: () => true,
      build: (item): TaskPayload => ({
        id: item.id,
        kind: 'edit',
        input: item.input,
        output: makeOutputPath(item.input, item.outputDir || outputDir, 'mp4', 'edit'),
        durationSec: item.source.durationSec,
        edit: {
          trimStartSec: trimStart,
          trimEndSec: trimEnd,
          cutSegments: [],
          rotation: { mode: rotationMode, flip: flipMode, metadataOnly: false },
          transcode: transcodeEnabled
        }
      })
    });
  };

  return (
    <div className="grid grid-cols-[1fr_420px] gap-4">
      <div className="space-y-4">
        {!selected ? (
          <div className="card flex min-h-[280px] items-center justify-center text-center text-muted">
            <div>
              <div className="text-3xl">⬇</div>
              <p className="mt-2 text-sm font-medium text-strong">{t('edit.empty.select')}</p>
              <button className="btn-primary mt-3" onClick={pickFiles}>{t('edit.empty.add')}</button>
            </div>
          </div>
        ) : (
          <div className="card space-y-4 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-strong">{selected.input.split(/[\\/]/).pop()}</p>
                <p className="text-xs text-faint">{selected.source.width}×{selected.source.height} · {selected.source.fps}fps · {selected.source.durationSec.toFixed(1)}s</p>
              </div>
              <button className="btn-ghost" onClick={pickFiles}>{t('edit.changeFile')}</button>
            </div>

            <div className="overflow-hidden rounded-xl border border-surface-600 bg-surface-800">
              <div className="flex min-h-[260px] items-center justify-center bg-black">
                {videoMode === 'html-video' && selected ? (
                  <video
                    ref={previewVideoRef}
                    src={selected.input}
                    controls={false}
                    className="block max-h-[420px] w-full object-contain bg-black"
                    onLoadedMetadata={(e) => {
                      e.currentTarget.currentTime = currentTime;
                    }}
                    onError={() => setVideoMode('frame')}
                    onPause={() => setPlaying(false)}
                    onPlay={() => setPlaying(true)}
                  />
                ) : previewFrame ? (
                  <img src={previewFrame} alt={t('edit.previewAlt')} className="block max-h-[420px] w-full object-contain" />
                ) : (
                  <div className="px-4 py-8 text-center text-xs text-muted">
                    {previewLoading ? t('edit.preview.loading') : t('edit.preview.unavailable')}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-faint">
                <span>{t('edit.currentFrame')}</span>
                <span>{currentTime.toFixed(2)}s / {duration.toFixed(2)}s</span>
              </div>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={scrubbing ? 0.1 : frameStep}
                value={currentTime}
                onPointerDown={() => {
                  setPlaying(false);
                  setScrubbing(true);
                }}
                onPointerUp={() => setScrubbing(false)}
                onPointerLeave={() => setScrubbing(false)}
                onInput={(e) => {
                  const nextTime = Number((e.target as HTMLInputElement).value);
                  setCurrentTime(nextTime);
                }}
                className="w-full accent-brand-500"
              />
              <div className="flex items-center gap-2">
                <button className="btn-ghost px-2" onClick={setTrimStartAtCurrent}>{t('edit.trim.setStart')}</button>
                <button
                  className="btn-ghost px-2"
                  title={t('edit.stepBackTitle')}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    stepHoldRef.current?.start(-1);
                  }}
                  onPointerUp={() => stepHoldRef.current?.stop()}
                  onPointerLeave={() => stepHoldRef.current?.stop()}
                  onPointerCancel={() => stepHoldRef.current?.stop()}
                >
                  ◀ {t('edit.stepBack')}
                </button>
                <button
                  className="btn-ghost px-2"
                  title={t('edit.stepForwardTitle')}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    stepHoldRef.current?.start(1);
                  }}
                  onPointerUp={() => stepHoldRef.current?.stop()}
                  onPointerLeave={() => stepHoldRef.current?.stop()}
                  onPointerCancel={() => stepHoldRef.current?.stop()}
                >
                  {t('edit.stepForward')} ▶
                </button>
                <button className="btn-ghost px-2" onClick={setTrimEndAtCurrent}>{t('edit.trim.setEnd')}</button>
              </div>
            </div>

            <div className="rounded-xl border border-surface-600 bg-surface-700/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs text-faint">
                <span>{t('edit.timeline')}</span>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> {t('edit.timeline.cut')}</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> {t('edit.timeline.trim')}</span>
                </div>
              </div>
              <div className="relative h-8 rounded bg-surface-800">
                <div className="absolute inset-0 flex">
                  {[...Array(20)].map((_, idx) => (
                    <div key={idx} className="h-full border-r border-surface-500/70" style={{ width: `${100 / 20}%` }} />
                  ))}
                </div>
                {timelineSegments.map((seg, idx) => (
                  <div
                    key={`${seg.kind}-${idx}`}
                    className={seg.kind === 'cut' ? 'absolute inset-y-0 bg-red-500' : 'absolute inset-y-0 bg-amber-400/70'}
                    style={{ left: `${seg.start * 100}%`, width: `${Math.max((seg.end - seg.start) * 100, 2)}%`, zIndex: seg.kind === 'cut' ? 2 : 1 }}
                  />
                ))}
                <div className="absolute inset-y-0 w-0.5 bg-brand-500" style={{ left: `${(currentTime / Math.max(duration, 1)) * 100}%` }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="card space-y-3">
          <div
            className="cursor-pointer rounded-lg border border-surface-600 bg-surface-700/60 p-3"
            onDoubleClick={() => setSubMenu('rotate')}
            title={t('edit.summary.openRotate')}
          >
            <div className="text-xs uppercase tracking-[0.2em] text-faint">{t('edit.summary.label')}</div>
            <div className="mt-1 text-sm text-strong">
              {summary.length ? t('edit.summary.adjusted', { n: String(summary.length), items: summary.join('、') }) : t('edit.summary.none')}
            </div>
          </div>

          <div className="space-y-2">
            <button className={subMenu === 'trim' ? 'btn-primary w-full' : 'btn-ghost w-full'} onClick={() => setSubMenu('trim')}>{t('edit.trim')}</button>
            <button className={subMenu === 'rotate' ? 'btn-primary w-full' : 'btn-ghost w-full'} onClick={() => setSubMenu('rotate')}>{t('edit.rotate')}</button>
            <button className={subMenu === 'transcode' ? 'btn-primary w-full' : 'btn-ghost w-full'} onClick={() => setSubMenu('transcode')}>{t('edit.transcode')}</button>
          </div>
        </div>

        {subMenu === 'trim' && (
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-strong">{t('edit.trim.title')}</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-faint">
                <span>{t('edit.trim.start')}: {trimStart.toFixed(2)}s</span>
                <span>{t('edit.trim.end')}: {trimEnd.toFixed(2)}s</span>
              </div>

              <div
                ref={trimBarRef}
                className="relative h-10 cursor-pointer rounded-lg border border-surface-600 bg-surface-800 px-2"
                onPointerDown={(e) => {
                  const rect = trimBarRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  const x = (e.clientX - rect.left) / Math.max(rect.width, 1);
                  const pointerSec = x * duration;
                  const startRatio = trimStart / Math.max(duration, 1);
                  const endRatio = trimEnd / Math.max(duration, 1);
                  if (Math.abs(pointerSec - trimStart) < 0.12) beginTrimDrag('start', e.clientX);
                  else if (Math.abs(pointerSec - trimEnd) < 0.12) beginTrimDrag('end', e.clientX);
                  else beginTrimDrag('move', e.clientX);
                }}
              >
                <div className="absolute inset-y-3 left-2 right-2 rounded bg-surface-700" />
                <div
                  className="absolute inset-y-3 rounded bg-amber-400/75"
                  style={{
                    left: `${(trimStart / Math.max(duration, 1)) * 100}%`,
                    width: `${Math.max(((trimEnd - trimStart) / Math.max(duration, 1)) * 100, 0)}%`
                  }}
                />
                <div
                  className="absolute top-1 bottom-1 w-1.5 cursor-ew-resize rounded-full bg-brand-500"
                  style={{ left: `${(trimStart / Math.max(duration, 1)) * 100}%` }}
                  onPointerDown={(e) => { e.stopPropagation(); beginTrimDrag('start', e.clientX); }}
                />
                <div
                  className="absolute top-1 bottom-1 w-1.5 cursor-ew-resize rounded-full bg-brand-500"
                  style={{ left: `${(trimEnd / Math.max(duration, 1)) * 100}%` }}
                  onPointerDown={(e) => { e.stopPropagation(); beginTrimDrag('end', e.clientX); }}
                />
              </div>
            </div>

          </div>
        )}

        {subMenu === 'rotate' && (
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-strong">{t('edit.rotate.title')}</h3>
            <div className="grid grid-cols-4 gap-2">
              {ROTATE_OPTIONS.map((item) => (
                <button key={item.v} className={rotationMode === item.v ? 'btn-primary' : 'btn-ghost'} onClick={() => setRotationMode(item.v)}>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {FLIP_OPTIONS.map((item) => (
                <button key={item.v} className={flipMode === item.v ? 'btn-primary' : 'btn-ghost'} onClick={() => setFlipMode(item.v)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {subMenu === 'transcode' && (
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-strong">{t('edit.transcode')}</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={transcodeEnabled} onChange={(e) => setTranscodeEnabled(e.target.checked)} />
              {t('edit.transcode.enable')}
            </label>
          </div>
        )}

        <OutputFolderPicker value={outputDir} onChange={changeOutputDir} required />

        {editProgressVisible && (
          <div className="card space-y-2 p-3">
            <div className="flex items-center justify-between text-xs text-faint">
              <span>{t('edit.progress.running')}</span>
              <span>{editProgress.toFixed(0)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-600">
              <div className="h-full rounded-full bg-brand-500 transition-[width] duration-200" style={{ width: `${editProgress}%` }} />
            </div>
          </div>
        )}

        <button className="btn-primary w-full" disabled={!outputDir || !selected || busy} onClick={() => void onStart()}>
          ▶ {t('edit.start')}
        </button>
      </div>
    </div>
  );
}
