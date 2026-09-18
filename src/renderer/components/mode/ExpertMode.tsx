import type { ExpertOptions, HWCapability, QueueItem, ResolvedParams } from '@shared/types';
import ResolvedParamsPanel from '../ResolvedParamsPanel';
import PresetManager from '../PresetManager';
import { useT } from '../../i18n';

interface Props {
  selected?: QueueItem | null;
  hardware: HWCapability | null;
  options: ExpertOptions;
  onChange: (patch: Partial<ExpertOptions>) => void;
  /** 由上层同步推导的生效参数（随参数改动实时更新） */
  resolved?: ResolvedParams | null;
}

const RESOLUTIONS = [480, 720, 1080, 1440, 2160];
const FPS_LIST = [24, 25, 30, 50, 60];

/** 专家模式面板（§13.3）：自由配置 + 封顶高亮 + 自定义预设 */
export default function ExpertMode({ selected, hardware, options, onChange, resolved }: Props) {
  const t = useT();

  const hwDisabled = (kind: string) => {
    if (!hardware) return kind !== 'software';
    if (kind === 'software') return false;
    return !Boolean((hardware as unknown as Record<string, boolean>)[kind]);
  };

  return (
    <div className="space-y-3">
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-strong">🔵 {t('expert.title')}</h3>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{t('expert.videoCodec')}</label>
            <select
              className="input"
              value={options.videoCodec}
              onChange={(e) =>
                onChange({ videoCodec: e.target.value as ExpertOptions['videoCodec'] })
              }
            >
              <option value="hevc">H.265 / HEVC</option>
              <option value="h264">H.264 / AVC</option>
              <option value="av1">AV1</option>
              <option value="vp9">VP9</option>
              <option value="copy">Stream copy</option>
            </select>
          </div>

          <div>
            <label className="label">{t('expert.hw')}</label>
            <select
              className="input"
              value={options.hw}
              onChange={(e) => onChange({ hw: e.target.value as ExpertOptions['hw'] })}
            >
              <option value="auto">{t('expert.hwAuto')}</option>
              <option value="nvenc" disabled={hwDisabled('nvenc')}>
                NVIDIA NVENC
              </option>
              <option value="qsv" disabled={hwDisabled('qsv')}>
                Intel QuickSync
              </option>
              <option value="amf" disabled={hwDisabled('amf')}>
                AMD AMF
              </option>
              <option value="videotoolbox" disabled={hwDisabled('videotoolbox')}>
                VideoToolbox / Apple MPS
              </option>
              <option value="vaapi" disabled={hwDisabled('vaapi')}>
                VAAPI
              </option>
              <option value="software">{t('expert.softOnly')}</option>
            </select>
          </div>

          <div className="col-span-2">
            <label className="label">{t('expert.resolution')}</label>
            <div className="flex gap-2">
              <select
                className="input min-w-0 flex-1"
                value={options.resolutionMode}
                onChange={(e) =>
                  onChange({ resolutionMode: e.target.value as ExpertOptions['resolutionMode'] })
                }
              >
                <option value="source">{t('expert.keepSource')}</option>
                <option value="custom">{t('expert.custom')}</option>
              </select>
              {options.resolutionMode === 'custom' && (
                <select
                  className="input min-w-0 flex-1"
                  value={options.resolution ?? 1080}
                  onChange={(e) => onChange({ resolution: Number(e.target.value) })}
                >
                  {RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r === 2160 ? '4K (2160)' : `${r}p`}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {options.resolutionMode === 'custom' && (
              <label className="mt-2 flex items-center justify-between rounded-md border border-divider bg-soft px-2 py-1.5 text-xs text-strong">
                <span>{t('expert.allowUpscale')}</span>
                <input
                  type="checkbox"
                  checked={Boolean(options.allowUpscale)}
                  onChange={(e) => onChange({ allowUpscale: e.target.checked })}
                />
              </label>
            )}
          </div>

          <div className="col-span-2">
            <label className="label">{t('expert.fps')}</label>
            <div className="flex gap-2">
              <select
                className="input min-w-0 flex-1"
                value={options.fpsMode}
                onChange={(e) => onChange({ fpsMode: e.target.value as ExpertOptions['fpsMode'] })}
              >
                <option value="source">{t('expert.keepSource')}</option>
                <option value="custom">{t('expert.custom')}</option>
              </select>
              {options.fpsMode === 'custom' && (
                <select
                  className="input min-w-0 flex-1"
                  value={options.fps ?? 30}
                  onChange={(e) => onChange({ fps: Number(e.target.value) })}
                >
                  {FPS_LIST.map((f) => (
                    <option key={f} value={f}>
                      {f} fps
                    </option>
                  ))}
                </select>
              )}
            </div>
            {options.fpsMode === 'custom' && (
              <label className="mt-2 flex items-center justify-between rounded-md border border-divider bg-soft px-2 py-1.5 text-xs text-strong">
                <span>{t('expert.allowIncreaseFps')}</span>
                <input
                  type="checkbox"
                  checked={Boolean(options.allowIncreaseFps)}
                  onChange={(e) => onChange({ allowIncreaseFps: e.target.checked })}
                />
              </label>
            )}
          </div>

          <div>
            <label className="label">{t('expert.bitrateMode')}</label>
            <select
              className="input"
              value={options.bitrateMode}
              onChange={(e) =>
                onChange({ bitrateMode: e.target.value as ExpertOptions['bitrateMode'] })
              }
            >
              <option value="crf">{t('expert.crfMode')}</option>
              <option value="cbr">{t('expert.cbrMode')}</option>
              <option value="vbr">{t('expert.vbrMode')}</option>
            </select>
          </div>

          {options.bitrateMode === 'crf' ? (
            <div>
              <label className="label">{t('expert.crf')}</label>
              <input
                className="input"
                type="number"
                min={0}
                max={51}
                value={options.crf ?? 23}
                onChange={(e) => onChange({ crf: Number(e.target.value) })}
              />
            </div>
          ) : (
            <div>
              <label className="label">{t('expert.targetBitrate')}</label>
              <input
                className="input"
                type="number"
                step={0.5}
                min={0.5}
                value={options.bitrateMbps ?? 6}
                onChange={(e) => onChange({ bitrateMbps: Number(e.target.value) })}
              />
            </div>
          )}

          <div>
            <label className="label">{t('expert.audioCodec')}</label>
            <select
              className="input"
              value={options.audioCodec}
              onChange={(e) =>
                onChange({ audioCodec: e.target.value as ExpertOptions['audioCodec'] })
              }
            >
              <option value="aac">AAC</option>
              <option value="mp3">MP3</option>
              <option value="opus">Opus</option>
              <option value="flac">FLAC</option>
              <option value="wav">WAV</option>
              <option value="none">{t('expert.removeAudio')}</option>
            </select>
          </div>

          <div>
            <label className="label">{t('expert.audioBitrate')}</label>
            <input
              className="input"
              type="number"
              value={options.audioBitrateKbps}
              onChange={(e) => onChange({ audioBitrateKbps: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="label">{t('expert.sampleRate')}</label>
            <select
              className="input"
              value={options.sampleRate}
              onChange={(e) =>
                onChange({ sampleRate: Number(e.target.value) as ExpertOptions['sampleRate'] })
              }
            >
              <option value={44100}>44100</option>
              <option value={48000}>48000</option>
              <option value={96000}>96000</option>
            </select>
          </div>

          <div>
            <label className="label">{t('expert.channels')}</label>
            <select
              className="input"
              value={options.channels}
              onChange={(e) => onChange({ channels: Number(e.target.value) })}
            >
              <option value={1}>{t('expert.mono')}</option>
              <option value={2}>{t('expert.stereo')}</option>
              <option value={6}>{t('expert.ch51')}</option>
            </select>
          </div>

          <div>
            <label className="label">{t('expert.container')}</label>
            <select
              className="input"
              value={options.container}
              onChange={(e) =>
                onChange({ container: e.target.value as ExpertOptions['container'] })
              }
            >
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
              <option value="mov">MOV</option>
              <option value="webm">WebM</option>
            </select>
          </div>

          <div className="col-span-2">
            <label className="label">{t('expert.extraArgs')}</label>
            <input
              className="input mono"
              value={options.extraArgs.join(' ')}
              placeholder="-tune film"
              onChange={(e) => onChange({ extraArgs: e.target.value.split(/\s+/).filter(Boolean) })}
            />
          </div>
        </div>
      </div>

      {selected && resolved && (
        <ResolvedParamsPanel
          source={selected.source}
          params={resolved}
          title={t('expert.paramsTitle')}
        />
      )}

      <PresetManager current={options} onApply={(o) => onChange(o)} />
    </div>
  );
}
