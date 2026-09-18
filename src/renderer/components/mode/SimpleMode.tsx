import type { QueueItem } from '@shared/types';
import ResolvedParamsPanel from '../ResolvedParamsPanel';
import ScaleResolutionSwitch from '../ScaleResolutionSwitch';
import Tooltip from '../Tooltip';
import { useT } from '../../i18n';

interface Props {
  selected?: QueueItem | null;
  scaleResolution: boolean;
  onScaleChange: (v: boolean) => void;
  target: { resolution: number; fps: number; bitrateMbps: number; crf?: number };
}

/** 普通（简单）模式面板（§13.2） */
export default function SimpleMode({
  selected,
  scaleResolution,
  onScaleChange,
  target
}: Props) {
  const t = useT();
  const crf = target.crf ?? 28;
  const vars = { r: target.resolution, b: target.bitrateMbps, c: crf };
  const rateText = `CRF ${crf}`;

  const rules = (
    <div className="space-y-1.5">
      <p className="font-medium text-strong">
        {target.resolution}p / {target.fps}fps / {rateText} / H.265 (HEVC)
      </p>
      <ul className="space-y-1 text-body">
        <li>• {t('simple.rule1', vars)}</li>
        <li>• {t('simple.rule2', vars)}</li>
        <li>• {t('simple.rule3', vars)}</li>
        <li className="text-muted">• {t('simple.rule4', vars)}</li>
      </ul>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="card">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-strong">🟢 {t('simple.title')}</h3>
          <Tooltip content={rules} width={430}>
            <span className="chip cursor-help bg-surface-700 text-muted">
              {t('simple.rules')} ⓘ
            </span>
          </Tooltip>
        </div>

        <Tooltip content={rules} width={430}>
          <p className="mt-1.5 cursor-help text-xs text-muted">
            {target.resolution}p / {target.fps}fps / {rateText} / H.265 (HEVC)
          </p>
        </Tooltip>
      </div>

      <ScaleResolutionSwitch
        value={scaleResolution}
        onChange={onScaleChange}
        target={target}
      />

      {selected ? (
        <ResolvedParamsPanel source={selected.source} decision={selected.decision} />
      ) : (
        <div className="card text-xs text-muted">{t('simple.pickFile')}</div>
      )}
    </div>
  );
}
