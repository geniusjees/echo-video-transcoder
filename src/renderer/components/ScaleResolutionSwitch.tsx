import Switch from './Switch';
import Tooltip, { InfoDot } from './Tooltip';
import { useT } from '../i18n';

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  target: { resolution: number; fps: number; bitrateMbps: number };
}

/** 「是否调整分辨率」开关（§13.2，情形 C） */
export default function ScaleResolutionSwitch({ value, onChange, disabled, target }: Props) {
  const t = useT();
  const vars = { r: target.resolution, f: target.fps, b: target.bitrateMbps };

  const hint = (
    <div className="space-y-2">
      <p className="font-medium text-strong">{t('scale.tipTitle', vars)}</p>
      <p className="text-body">{t('scale.tipOn', vars)}</p>
      <p className="text-body">{t('scale.tipOff', vars)}</p>
      <p className="text-muted">{t('scale.tipBottom', vars)}</p>
    </div>
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-body">{t('scale.title')}</span>
          <Tooltip content={hint} width={360}>
            <span className="cursor-help">
              <InfoDot />
            </span>
          </Tooltip>
        </div>
        <Switch
          checked={value}
          onChange={onChange}
          disabled={disabled}
          label={t('scale.title')}
        />
      </div>
      <p className="mt-1.5 text-xs text-faint">
        {value ? t('scale.onCurrent', vars) : t('scale.offCurrent', vars)}
      </p>
    </div>
  );
}
