import { useState } from 'react';
import type { SegmentInfo } from '@shared/types';
import { useT } from '../../i18n';
import { formatDuration } from '../../utils/format';

interface Props {
  segment: SegmentInfo;
  onChange: (trim: { startSec: number; endSec: number } | undefined) => void;
  onClose: () => void;
}

/** 片段首尾裁剪（§13.4） */
export default function SegmentTrim({ segment, onChange, onClose }: Props) {
  const t = useT();
  const duration = segment.source.durationSec || 0;
  const [start, setStart] = useState(segment.trim?.startSec ?? 0);
  const [end, setEnd] = useState(segment.trim?.endSec ?? duration);

  return (
    <div className="card border-brand-500/50">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-strong">
          {t('concat.trimTitle', { name: segment.input.split(/[\\/]/).pop() ?? '' })}
        </span>
        <button className="text-xs text-muted" onClick={onClose}>
          {t('concat.close')}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('audio.startSec')}</label>
          <input
            className="input"
            type="number"
            min={0}
            max={duration}
            step={0.1}
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
          />
          <span className="text-xs text-faint">{formatDuration(start)}</span>
        </div>
        <div>
          <label className="label">{t('audio.endSec')}</label>
          <input
            className="input"
            type="number"
            min={0}
            max={duration}
            step={0.1}
            value={end}
            onChange={(e) => setEnd(Number(e.target.value))}
          />
          <span className="text-xs text-faint">{formatDuration(end)}</span>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          className="btn-primary"
          onClick={() => {
            onChange(end > start ? { startSec: start, endSec: end } : undefined);
            onClose();
          }}
        >
          {t('concat.apply')}
        </button>
        <button
          className="btn-ghost"
          onClick={() => {
            onChange(undefined);
            onClose();
          }}
        >
          {t('concat.clearTrim')}
        </button>
      </div>
    </div>
  );
}
