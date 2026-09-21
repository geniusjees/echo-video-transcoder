import { formatConcatReason } from '@shared/concatI18n';
import type { ConcatPlan } from '@shared/types';
import { useI18nStore, useT } from '../../i18n';
import { codecLabel, formatDuration } from '../../utils/format';

interface Props {
  plan: ConcatPlan | null;
  segments: { id: string; name: string }[];
}

/** 拼接方案摘要：纯拼接 / 转码对齐 + 音频统一说明（§13.4） */
export default function ConcatPlanSummary({ plan, segments }: Props) {
  const t = useT();
  const locale = useI18nStore((s) => s.locale);

  if (!plan) {
    return <div className="card text-sm text-faint">{t('concat.planEmpty')}</div>;
  }

  const copy = plan.strategy === 'copy';
  const silenceNames = plan.silenceSegments
    .map((id) => segments.find((s) => s.id === id)?.name)
    .filter(Boolean) as string[];
  const sourceA = plan.segments[0]?.source;
  const mismatched = plan.segments.find(
    (item) =>
      item.source.width !== sourceA?.width || item.source.height !== sourceA?.height ||
      Math.abs(item.source.fps - (sourceA?.fps ?? 0)) > 0.05
  )?.source;
  const decisionText = copy
    ? formatConcatReason(locale, { equal: true })
    : formatConcatReason(locale, {
        equal: false,
        fromW: sourceA?.width ?? 0,
        fromH: sourceA?.height ?? 0,
        toW: mismatched?.width ?? sourceA?.width ?? 0,
        toH: mismatched?.height ?? sourceA?.height ?? 0,
        res: plan.uniform.resolution,
        fps: plan.uniform.fps,
        bitrate: plan.uniform.bitrateMbps,
        codec: plan.uniform.codec
      });

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-strong">{t('concat.planTitle')}</h3>
        <span
          className={`chip ${copy ? 'bg-ok-bg text-ok-strong' : 'bg-warn-bg text-warn-strong'}`}
        >
          {copy ? t('concat.strategyCopy') : t('concat.strategyTranscode')}
        </span>
      </div>

      <ul className="space-y-1 text-xs text-body">
        <li>
          • {t('concat.decision')}
          {decisionText}
        </li>
        <li>
          • {t('concat.uniform')}
          {plan.uniform.resolution}p / {plan.uniform.fps}fps / {plan.uniform.bitrateMbps}Mbps /{' '}
          {codecLabel(plan.uniform.codec)}
          {plan.uniform.hwCodec ? ` · ${plan.uniform.hwCodec}` : ''}
        </li>
        <li>
          •{' '}
          {t('concat.audioUnify', {
            rate: plan.audio.sampleRate / 1000,
            ch: plan.audio.channels === 2 ? t('audio.stereo') : `${plan.audio.channels}ch`
          })}
        </li>
        {silenceNames.length > 0 && (
          <li className="text-warn-strong">
            • {t('concat.silence', { names: silenceNames.join('、') })}
          </li>
        )}
        <li>
          • {t('concat.totalDuration')}
          {formatDuration(plan.totalDurationSec)}
        </li>
        <li className="text-muted">
          • {copy ? t('concat.estimateCopy') : t('concat.estimateTranscode')}（{t('concat.estimate')}
          {plan.estimate === 'fast'
            ? t('concat.estimateFast')
            : plan.estimate === 'normal'
              ? t('concat.estimateNormal')
              : t('concat.estimateSlow')}
          ）
        </li>
      </ul>
    </div>
  );
}
