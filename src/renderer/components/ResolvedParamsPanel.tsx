import type { ResolvedParams, SourceInfo, SimpleDecision } from '@shared/types';
import { codecLabel, formatBitrate, resolutionLabel } from '../utils/format';
import AutoBitrateHint from './AutoBitrateHint';
import { useT } from '../i18n';

interface Props {
  source: SourceInfo;
  decision?: SimpleDecision | null;
  params?: ResolvedParams | null;
  title?: string;
}

/** ★ 生效参数预览：展示真实生效值 + 封顶 / 自动标注（C7） */
export default function ResolvedParamsPanel({ source, decision, params, title }: Props) {
  const t = useT();
  const p = params ?? decision?.params ?? null;

  const rows: { label: string; from: string; to: string; capped?: boolean }[] = [
    {
      label: t('params.resolution'),
      from: `${source.width}×${source.height}（${resolutionLabel(source.width, source.height)}）`,
      to: p ? `${p.resolution}p` : t('params.keep'),
      capped: Boolean(p?.caps?.resolution)
    },
    {
      label: t('params.fps'),
      from: `${source.fps || '-'} fps`,
      to: p ? `${p.fps} fps` : t('params.keep'),
      capped: Boolean(p?.caps?.fps)
    },
    {
      label: t('params.bitrate'),
      from: formatBitrate(source.bitrateMbps),
      to: p
        ? p.bitrateMbps
          ? formatBitrate(p.bitrateMbps)
          : `${t('params.crfPrefix')} ${p.crf ?? '-'}`
        : t('params.keep'),
      capped: Boolean(p?.caps?.bitrate)
    },
    {
      label: t('params.codec'),
      from: codecLabel(source.codec),
      to: p ? codecLabel(p.codec) : t('params.keep')
    }
  ];

  if (p) {
    rows.push(
      {
        label: t('params.audio'),
        from: source.hasAudio
          ? `${codecLabel(source.audioCodec ?? '')} / ${source.sampleRate ?? '-'}Hz`
          : t('params.noAudio'),
        to:
          p.audioCodec === 'none'
            ? t('params.removeAudio')
            : `${p.audioCodec.toUpperCase()} ${p.audioBitrateKbps}k / ${p.sampleRate}Hz / ${p.channels}ch`
      },
      {
        label: t('params.container'),
        from: '-',
        to: `${p.container.toUpperCase()} · ${p.hwCodec ?? t('hw.software')}`
      }
    );
  }

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-strong">{title ?? t('params.title')}</h3>
        {decision?.action === 'no-op' && (
          <span className="chip bg-surface-600 text-body">{t('params.noTranscode')}</span>
        )}
        {p?.capped && decision?.action !== 'no-op' && (
          <span className="chip bg-warn-bg text-warn-strong">{t('params.cappedBadge')}</span>
        )}
      </div>

      {decision?.action === 'no-op' ? (
        <p className="text-sm text-muted">{t('queue.noTranscode')}</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-surface-600">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-700 text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">{t('params.param')}</th>
                  <th className="px-3 py-2">{t('params.source')}</th>
                  <th className="px-3 py-2">{t('params.output')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-t border-surface-600">
                    <td className="px-3 py-1.5 text-muted">{r.label}</td>
                    <td className="px-3 py-1.5 text-body">{r.from}</td>
                    <td className="px-3 py-1.5">
                      <span className={r.capped ? 'text-warn-strong' : 'text-accent'}>{r.to}</span>
                      {r.capped && (
                        <span className="ml-1 text-xs text-warn">{t('params.cappedMark')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {decision && <AutoBitrateHint decision={decision} source={source} />}
        </>
      )}
    </div>
  );
}
