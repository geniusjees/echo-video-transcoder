import { useEffect } from 'react';
import { isHwUsableForCodec, type HWFamily } from '@shared/params';
import type { ExpertOptions, HWCapability, QueueItem, ResolvedParams } from '@shared/types';
import ResolvedParamsPanel from '../ResolvedParamsPanel';
import PresetManager from '../PresetManager';
import NumberField from '../NumberField';
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
  const sourceHeight = selected?.source.height ?? 0;
  const sourceFps = selected?.source.fps ?? 0;

  /**
   * 自定义档位的当前值：优先用户已选值，否则取「当前生效值」（= 源尺寸）。
   * 若当前生效值不在预设档位里（如 800p / 29.97fps），把它补进选项，
   * 保证下拉框显示的值与真实生效值始终一致，且切到自定义不会改变输出。
   */
  const resolutionValue = options.resolution ?? (resolved?.resolution || sourceHeight || 1080);
  const fpsValue = options.fps ?? (resolved?.fps || sourceFps || 30);

  const resolutionOptions = (() => {
    const list = [...RESOLUTIONS];
    if (resolutionValue > 0 && !list.includes(resolutionValue)) list.push(resolutionValue);
    return list.sort((a, b) => a - b);
  })();
  const fpsOptions = (() => {
    const list = [...FPS_LIST];
    if (fpsValue > 0 && !list.includes(fpsValue)) list.push(fpsValue);
    return list.sort((a, b) => a - b);
  })();

  /** 选了比源更高的值但没勾选「允许放大 / 提高帧率」→ 实际不生效，给出说明 */
  const upscaleBlocked =
    options.resolutionMode === 'custom' &&
    sourceHeight > 0 &&
    resolutionValue > sourceHeight &&
    !options.allowUpscale;
  const fpsBlocked =
    options.fpsMode === 'custom' &&
    sourceFps > 0 &&
    fpsValue > sourceFps &&
    !options.allowIncreaseFps;

  // 关键：切到「自定义」时必须真正把数值写进 options。
  // 否则 resolveExpertParams 认为没有自定义值而继续沿用源分辨率，
  // 表现为「下拉框显示 1080p，但输出仍是源分辨率」。
  useEffect(() => {
    if (options.resolutionMode === 'custom' && !options.resolution) {
      onChange({ resolution: resolutionValue });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.resolutionMode, options.resolution, onChange]);

  useEffect(() => {
    if (options.fpsMode === 'custom' && !options.fps) {
      onChange({ fps: fpsValue });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.fpsMode, options.fps, onChange]);

  /**
   * 硬件选项是否禁用：厂商不存在，或该厂商不支持当前所选编码
   * （如 VideoToolbox 无 AV1、老卡的 av1_nvenc/av1_amf 探测不通过）。
   * 与选编码器的判据一致，避免「选了某硬件但实际回退软件编码」。
   */
  const hwDisabled = (kind: HWFamily) => !isHwUsableForCodec(hardware, kind, options.videoCodec);

  const HW_FAMILIES: HWFamily[] = ['nvenc', 'qsv', 'amf', 'videotoolbox', 'vaapi'];
  /** 当前选中的硬件在当前编码下不可用 → 实际会回退软件编码，给出提示 */
  const selectedHwFamily = ((): HWFamily | null => {
    const hw = options.hw;
    if (hw === 'auto' || hw === 'software') return null;
    const fam = (hw === 'videotoolbox-mps' ? 'videotoolbox' : hw) as HWFamily;
    return HW_FAMILIES.includes(fam) ? fam : null;
  })();
  const hwFallbackWarning = selectedHwFamily !== null && hwDisabled(selectedHwFamily);

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
              <option
                value="nvenc"
                disabled={hwDisabled('nvenc')}
                title={hwDisabled('nvenc') ? t('expert.hwUnavailable') : undefined}
              >
                NVIDIA NVENC
              </option>
              <option
                value="qsv"
                disabled={hwDisabled('qsv')}
                title={hwDisabled('qsv') ? t('expert.hwUnavailable') : undefined}
              >
                Intel QuickSync
              </option>
              <option
                value="amf"
                disabled={hwDisabled('amf')}
                title={hwDisabled('amf') ? t('expert.hwUnavailable') : undefined}
              >
                AMD AMF
              </option>
              <option
                value="videotoolbox"
                disabled={hwDisabled('videotoolbox')}
                title={hwDisabled('videotoolbox') ? t('expert.hwUnavailable') : undefined}
              >
                VideoToolbox / Apple MPS
              </option>
              <option
                value="vaapi"
                disabled={hwDisabled('vaapi')}
                title={hwDisabled('vaapi') ? t('expert.hwUnavailable') : undefined}
              >
                VAAPI
              </option>
              <option value="software">{t('expert.softOnly')}</option>
            </select>
            {hwFallbackWarning && (
              <p className="mt-1 text-xs text-warn">{t('expert.hwUnavailable')}</p>
            )}
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
                  value={resolutionValue}
                  onChange={(e) => onChange({ resolution: Number(e.target.value) })}
                >
                  {resolutionOptions.map((r) => (
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
            {upscaleBlocked && (
              <p className="mt-1 text-xs text-warn">
                {t('expert.upscaleBlocked', { h: sourceHeight })}
              </p>
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
                  value={fpsValue}
                  onChange={(e) => onChange({ fps: Number(e.target.value) })}
                >
                  {fpsOptions.map((f) => (
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
            {fpsBlocked && (
              <p className="mt-1 text-xs text-warn">
                {t('expert.fpsBlocked', { f: sourceFps })}
              </p>
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
              <NumberField
                value={options.crf ?? 26}
                min={0}
                max={51}
                onChange={(v) => onChange({ crf: v })}
              />
            </div>
          ) : (
            <div>
              <label className="label">{t('expert.targetBitrate')}</label>
              <NumberField
                value={options.bitrateMbps ?? 6}
                decimal
                min={0.5}
                onChange={(v) => onChange({ bitrateMbps: v })}
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
            <NumberField
              value={options.audioBitrateKbps}
              min={1}
              onChange={(v) => onChange({ audioBitrateKbps: v })}
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
