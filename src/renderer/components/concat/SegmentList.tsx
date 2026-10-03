import { useState } from 'react';
import type { SegmentInfo } from '@shared/types';
import { useT } from '../../i18n';
import { baseName, formatDuration, resolutionLabel } from '../../utils/format';
import SegmentTrim from './SegmentTrim';

interface Props {
  segments: SegmentInfo[];
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onTrimChange: (id: string, trim: { startSec: number; endSec: number } | undefined) => void;
}

/** 片段列表：拖拽排序 + 音轨状态 + 裁剪（§13.4） */
export default function SegmentList({ segments, onMove, onRemove, onTrimChange }: Props) {
  const t = useT();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  if (!segments.length) {
    return <div className="card text-center text-sm text-faint">{t('concat.empty')}</div>;
  }

  return (
    <div className="space-y-2">
      {segments.map((seg, i) => (
        // 片段与它的裁剪面板作为一组，裁剪面板紧跟在当前片段下方
        <div key={seg.id} className="space-y-2">
          <div
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(i);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== i) onMove(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={`card flex items-center gap-3 p-2.5 ${
              overIndex === i && dragIndex !== null && dragIndex !== i ? 'border-brand-500' : ''
            }`}
          >
            <span className="cursor-grab select-none text-faint">☰</span>
            <span className="w-5 text-center text-xs text-muted">{i + 1}</span>

            {seg.thumbnail ? (
              <img src={seg.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded object-cover" />
            ) : (
              <div className="h-12 w-20 shrink-0 rounded bg-surface-700" />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-strong">{baseName(seg.input)}</span>
                <span className="chip bg-surface-600 text-body">
                  {seg.hasAudio ? t('concat.hasAudio') : t('concat.noAudio')}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-faint">
                {resolutionLabel(seg.source.width, seg.source.height)} · {seg.source.fps}fps ·{' '}
                {formatDuration(seg.source.durationSec)}
                {seg.trim && (
                  <span className="ml-1 text-accent">
                    ·{' '}
                    {t('concat.trimmed', {
                      from: formatDuration(seg.trim.startSec),
                      to: formatDuration(seg.trim.endSec)
                    })}
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 gap-2 text-xs">
              <button
                className="text-accent hover:underline"
                onClick={() => setEditing(editing === seg.id ? null : seg.id)}
              >
                {t('concat.trim')}
              </button>
              <button className="text-muted hover:underline" onClick={() => onMove(i, i - 1)}>
                ↑
              </button>
              <button className="text-muted hover:underline" onClick={() => onMove(i, i + 1)}>
                ↓
              </button>
              <button className="text-err hover:underline" onClick={() => onRemove(seg.id)}>
                {t('concat.remove')}
              </button>
            </div>
          </div>

          {editing === seg.id && (
            <SegmentTrim
              segment={seg}
              onChange={(trim) => onTrimChange(seg.id, trim)}
              onClose={() => setEditing(null)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
