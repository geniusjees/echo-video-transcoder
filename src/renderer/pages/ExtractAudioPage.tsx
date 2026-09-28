import { useState } from 'react';
import type { AudioCodec, TaskPayload } from '@shared/types';
import { AUDIO_EXT } from '@shared/constants';
import OutputFolderPicker from '../components/OutputFolderPicker';
import QueueList from '../components/QueueList';
import { useConfigStore } from '../stores/configStore';
import { useQueueStore } from '../stores/queueStore';
import { useDropHandler } from '../hooks/useDropHandler';
import { useT } from '../i18n';
import { makeOutputPath } from '../utils/output';
import { formatDuration } from '../utils/format';

/** 音频提取页（§10.5） */
export default function ExtractAudioPage() {
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

  const [codec, setCodec] = useState<AudioCodec>('mp3');
  const [bitrateKbps, setBitrateKbps] = useState(192);
  const [sampleRate, setSampleRate] = useState(48000);
  const [channels, setChannels] = useState(2);
  const [useRange, setUseRange] = useState(false);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(60);

  const outputDir = config?.paths.outputDir ?? '';

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
      kind: 'extractAudio',
      filter: () => true,
      build: (item): TaskPayload => ({
        id: item.id,
        kind: 'extractAudio',
        input: item.input,
        output: makeOutputPath(
          item.input,
          item.outputDir || outputDir,
          AUDIO_EXT[codec],
          'extractAudio'
        ),
        durationSec: item.source.durationSec,
        audio: {
          codec,
          bitrateKbps,
          sampleRate: sampleRate as 44100 | 48000 | 96000,
          channels,
          startSec: useRange ? startSec : undefined,
          endSec: useRange ? endSec : undefined
        }
      })
    });
  };

  return (
    <div className="grid grid-cols-[1fr_380px] gap-4">
      <div className="space-y-4">
        <QueueList
          titleKey="queue.titleAudio"
          items={items}
          progress={progress}
          onRemove={remove}
          onAdd={pickFiles}
          onAddFolder={pickFolder}
          kind="audio"
          audio={{
            codec,
            bitrateKbps,
            sampleRate,
            channels,
            startSec: useRange ? startSec : undefined,
            endSec: useRange ? endSec : undefined
          }}
        />
      </div>

      <div className="space-y-4">
        <div className="card space-y-3">
          <h3 className="text-sm font-semibold text-strong">{t('audio.title')}</h3>

          <div>
            <label className="label">{t('audio.format')}</label>
            <div className="grid grid-cols-5 gap-1.5">
              {(['mp3', 'aac', 'wav', 'flac', 'opus'] as AudioCodec[]).map((c) => (
                <button
                  key={c}
                  className={codec === c ? 'btn-primary px-2' : 'btn-ghost px-2'}
                  onClick={() => setCodec(c)}
                >
                  {c.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('audio.bitrate')}</label>
              <input
                className="input"
                type="number"
                value={bitrateKbps}
                onChange={(e) => setBitrateKbps(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">{t('audio.sampleRate')}</label>
              <select
                className="input"
                value={sampleRate}
                onChange={(e) => setSampleRate(Number(e.target.value))}
              >
                <option value={44100}>44100</option>
                <option value={48000}>48000</option>
                <option value={96000}>96000</option>
              </select>
            </div>
            <div>
              <label className="label">{t('audio.channels')}</label>
              <select
                className="input"
                value={channels}
                onChange={(e) => setChannels(Number(e.target.value))}
              >
                <option value={1}>{t('audio.mono')}</option>
                <option value={2}>{t('audio.stereo')}</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useRange}
              onChange={(e) => setUseRange(e.target.checked)}
            />
            {t('audio.rangeOnly')}
          </label>

          {useRange && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('audio.startSec')}</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={startSec}
                  onChange={(e) => setStartSec(Number(e.target.value))}
                />
                <span className="text-xs text-faint">{formatDuration(startSec)}</span>
              </div>
              <div>
                <label className="label">{t('audio.endSec')}</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={endSec}
                  onChange={(e) => setEndSec(Number(e.target.value))}
                />
                <span className="text-xs text-faint">{formatDuration(endSec)}</span>
              </div>
            </div>
          )}
        </div>

        <OutputFolderPicker value={outputDir} onChange={changeOutputDir} required />

        <button
          className="btn-primary w-full"
          disabled={!outputDir || !items.length || busy}
          onClick={onStart}
        >
          ▶ {t('audio.start')}
        </button>
      </div>
    </div>
  );
}
