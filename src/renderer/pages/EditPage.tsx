import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditCutSegment, FlipMode, RotateMode, TaskPayload } from '@shared/types';
import OutputFolderPicker from '../components/OutputFolderPicker';
import { useConfigStore } from '../stores/configStore';
import { useQueueStore } from '../stores/queueStore';
import { useDropHandler } from '../hooks/useDropHandler';
import { useT } from '../i18n';
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

  const [subMenu, setSubMenu] = useState<'trim' | 'rotate' | 'transcode' | 'audio' | null>('trim');
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [cutSegments, setCutSegments] = useState<EditCutSegment[]>([]);
  const [rotationMode, setRotationMode] = useState<RotateMode>(0);
  const [flipMode, setFlipMode] = useState<FlipMode>('none');
  const [transcodeEnabled, setTranscodeEnabled] = useState(false);
  const [bgAudioInput, setBgAudioInput] = useState('');
  const [bgAudioEnabled, setBgAudioEnabled] = useState(false);
  const [originalVolume, setOriginalVolume] = useState(1);
  const [backgroundVolume, setBackgroundVolume] = useState(0.3);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const holdRef = useRef<number | null>(null);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selected || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const apply = () => setCurrentTime((prev) => clamp(prev + direction * frameStep, 0, duration));
      apply();
      if (holdRef.current) window.clearInterval(holdRef.current);
      holdRef.current = window.setInterval(apply, 80);
    };
    const onKeyUp = () => {
      if (holdRef.current) {
        window.clearInterval(holdRef.current);
        holdRef.current = null;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (holdRef.current) clearInterval(holdRef.current);
    };
  }, [duration, frameStep, selected]);

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
    if (bgAudioEnabled || bgAudioInput) changes.push(t('edit.summary.audio'));
    if (cutSegments.length > 0 || trimStart > 0 || trimEnd < duration) changes.push(t('edit.summary.trim'));
    return changes;
  }, [bgAudioEnabled, bgAudioInput, cutSegments.length, duration, flipMode, rotationMode, t, transcodeEnabled, trimEnd, trimStart]);

  const trimSelectionVisible = trimStart !== trimEnd && trimEnd > trimStart && duration > 0;

  const timelineSegments = [
    ...cutSegments.map((seg) => ({ start: seg.startSec / Math.max(duration, 1), end: seg.endSec / Math.max(duration, 1), kind: 'cut' as const })),
    ...(trimSelectionVisible ? [{ start: trimStart / Math.max(duration, 1), end: trimEnd / Math.max(duration, 1), kind: 'trim' as const }] : [])
  ];

  const addCutSegment = () => {
    if (!selected || trimStart >= trimEnd) return;
    setCutSegments((prev) => [...prev, { startSec: trimStart, endSec: trimEnd }]);
  };

  const keepMiddleSegment = () => {
    if (!selected || trimStart >= trimEnd) return;
    const start = Math.min(trimStart, trimEnd);
    const end = Math.max(trimStart, trimEnd);
    const nextCuts: EditCutSegment[] = [];
    if (start > 0) nextCuts.push({ startSec: 0, endSec: start });
    if (end < duration) nextCuts.push({ startSec: end, endSec: duration });
    setCutSegments((prev) => [...prev, ...nextCuts]);
  };

  const removeLatestCutSegment = () => {
    setCutSegments((prev) => prev.slice(0, -1));
  };

  const clearAllCutSegments = () => {
    setCutSegments([]);
  };

  const onStart = async () => {
    if (!selected) return;
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
          cutSegments,
          rotation: { mode: rotationMode, flip: flipMode, metadataOnly: false },
          transcode: transcodeEnabled,
          backgroundAudio: bgAudioEnabled && bgAudioInput
            ? { input: bgAudioInput, originalVolume, backgroundVolume }
            : undefined
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
                <button className="btn-ghost px-2" onClick={() => setCurrentTime((v) => clamp(v - frameStep, 0, duration))} title={t('edit.stepBackTitle')}>◀ {t('edit.stepBack')}</button>
                <button className="btn-ghost px-2" onClick={() => setCurrentTime((v) => clamp(v + frameStep, 0, duration))} title={t('edit.stepForwardTitle')}>{t('edit.stepForward')} ▶</button>
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
            <button className={subMenu === 'audio' ? 'btn-primary w-full' : 'btn-ghost w-full'} onClick={() => setSubMenu('audio')}>{t('edit.audio')}</button>
          </div>
        </div>

        {subMenu === 'trim' && (
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-strong">{t('edit.trim.title')}</h3>
            <div className="space-y-3">
              <div>
                <label className="label">{t('edit.trim.start')}</label>
                <input type="range" min={0} max={Math.max(duration, 0)} step={frameStep} value={trimStart} onChange={(e) => setTrimStart(Number(e.target.value))} className="w-full accent-brand-500" />
                <div className="text-xs text-faint">{trimStart.toFixed(2)}s</div>
              </div>
              <div>
                <label className="label">{t('edit.trim.end')}</label>
                <input type="range" min={0} max={Math.max(duration, 0)} step={frameStep} value={trimEnd} onChange={(e) => setTrimEnd(Number(e.target.value))} className="w-full accent-brand-500" />
                <div className="text-xs text-faint">{trimEnd.toFixed(2)}s</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={() => setTrimStart(currentTime)}>{t('edit.trim.setStart')}</button>
              <button className="btn-ghost" onClick={() => setTrimEnd(currentTime)}>{t('edit.trim.setEnd')}</button>
            </div>

            <button className="btn-primary w-full" onClick={addCutSegment}>{t('edit.trim.markMiddle')}</button>
            <button className="btn-ghost w-full" onClick={keepMiddleSegment}>{t('edit.trim.keepMiddle')}</button>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-ghost" onClick={removeLatestCutSegment} disabled={!cutSegments.length}>{t('edit.trim.undo')}</button>
              <button className="btn-ghost" onClick={clearAllCutSegments} disabled={!cutSegments.length}>{t('edit.trim.clear')}</button>
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

        {subMenu === 'audio' && (
          <div className="card space-y-3">
            <h3 className="text-sm font-semibold text-strong">{t('edit.audio')}</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bgAudioEnabled} onChange={(e) => setBgAudioEnabled(e.target.checked)} />
              {t('edit.audio.add')}
            </label>
            <input className="input" value={bgAudioInput} onChange={(e) => setBgAudioInput(e.target.value)} placeholder={t('edit.audio.placeholder')} />
            <button className="btn-ghost" onClick={async () => {
              const picked = await window.api.selectFiles();
              if (picked?.[0]) setBgAudioInput(picked[0]);
            }}>{t('edit.audio.select')}</button>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('edit.audio.volumeOriginal')}</label>
                <input className="input" type="range" min={0} max={1} step={0.05} value={originalVolume} onChange={(e) => setOriginalVolume(Number(e.target.value))} />
                <div className="text-xs text-faint">{originalVolume.toFixed(2)}</div>
              </div>
              <div>
                <label className="label">{t('edit.audio.volumeBackground')}</label>
                <input className="input" type="range" min={0} max={1} step={0.05} value={backgroundVolume} onChange={(e) => setBackgroundVolume(Number(e.target.value))} />
                <div className="text-xs text-faint">{backgroundVolume.toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}

        <OutputFolderPicker value={outputDir} onChange={changeOutputDir} required />

        <button className="btn-primary w-full" disabled={!outputDir || !selected || busy} onClick={() => void onStart()}>
          ▶ {t('edit.start')}
        </button>
      </div>
    </div>
  );
}
