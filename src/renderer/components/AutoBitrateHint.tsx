import type { ResolvedParams, SimpleDecision, SourceInfo } from '@shared/types';
import { formatBitrate } from '../utils/format';
import { useT } from '../i18n';

interface Props {
  decision: SimpleDecision;
  source: SourceInfo;
}

/** 码率自动计算 / 封顶提示（C7） */
export default function AutoBitrateHint({ decision, source }: Props) {
  const t = useT();
  if (!decision.params) return null;
  const p: ResolvedParams = decision.params;
  const hints: { text: string; tone: string }[] = [];

  if (decision.autoBitrate) {
    const tail = p.caps.bitrate
      ? t('hint.autoCapped', { br: formatBitrate(source.bitrateMbps) })
      : t('hint.autoNotCapped');
    hints.push({
      text: `${t('hint.autoBitrate')}${tail}`,
      tone: 'bg-info-bg text-info-strong'
    });
  }
  if (p.caps.resolution) {
    hints.push({ text: t('hint.resKept'), tone: 'bg-warn-bg text-warn-strong' });
  }
  if (p.caps.fps) {
    hints.push({
      text: t('hint.fpsKept', { fps: source.fps }),
      tone: 'bg-warn-bg text-warn-strong'
    });
  }
  if (p.caps.bitrate && !decision.autoBitrate) {
    hints.push({
      text: t('hint.bitrateCapped', {
        br: formatBitrate(source.bitrateMbps),
        to: formatBitrate(p.bitrateMbps)
      }),
      tone: 'bg-warn-bg text-warn-strong'
    });
  }
  if (source.height < 1080 && p.bitrateMbps <= 6) {
    hints.push({
      text: t('hint.keepResLower', { h: source.height, b: p.bitrateMbps }),
      tone: 'bg-info-bg text-info-strong'
    });
  }

  if (!hints.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {hints.map((h, i) => (
        <span key={i} className={`chip ${h.tone}`}>
          {h.text}
        </span>
      ))}
    </div>
  );
}
