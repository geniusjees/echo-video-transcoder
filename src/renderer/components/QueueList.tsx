import type { ProgressPayload, QueueItem, ResolvedParams } from '@shared/types';
import {
  baseName,
  codecLabel,
  formatBitrate,
  formatDuration,
  formatSize,
  resolutionLabel
} from '../utils/format';
import { estimateForItem } from '../utils/estimate';
import { useDropStore } from '../stores/dropStore';
import { useT } from '../i18n';
import ProgressBar, { StatusChip } from './ProgressBar';

interface Props {
  items: QueueItem[];
  progress: Record<string, ProgressPayload>;
  onRemove?: (id: string) => void;
  onClear?: () => void;
  /** 打开文件选择器 */
  onAdd?: () => void;
  /** 选择文件夹导入（递归子文件夹） */
  onAddFolder?: () => void;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** 列表标题的 i18n key（默认 queue.title） */
  titleKey?: string;
  /** 当前模式：专家模式下用 expertResolved 的生效参数 */
  mode?: 'simple' | 'expert';
  /** 专家模式下每个条目的生效参数 */
  expertResolved?: Record<string, ResolvedParams>;
  /**
   * fill  : 自适应高度，占满父容器，超出内部滚动（转码页）
   * capped: 固定上限高度，超出内部滚动（旋转/提取音频页）
   */
  variant?: 'fill' | 'capped';
}

/** capped 模式下的高度上限：恰好容纳 8 个条目（84px + 8px 间距） */
const CAPPED_MAX_HEIGHT = 728;

export default function QueueList({
  items,
  progress,
  onRemove,
  onClear,
  onAdd,
  onAddFolder,
  selectedId,
  onSelect,
  titleKey,
  mode = 'simple',
  expertResolved,
  variant = 'capped'
}: Props) {
  const t = useT();
  const dragging = useDropStore((s) => s.dragging);
  const isFill = variant === 'fill';

  const paramsFor = (item: QueueItem): ResolvedParams | null =>
    mode === 'expert' ? (expertResolved?.[item.id] ?? item.resolved) : item.resolved;

  const header = (
    <div className="flex shrink-0 items-center justify-between">
      <span className="text-sm font-semibold text-body">
        {t(titleKey ?? 'queue.title')}
        {items.length > 0 && <span className="ml-1.5 text-xs text-faint">（{items.length}）</span>}
      </span>
      <div className="flex items-center gap-3 text-xs">
        {onAdd && (
          <button className="text-accent hover:underline" onClick={onAdd}>
            {t('queue.addFiles')}
          </button>
        )}
        {onAddFolder && (
          <button className="text-accent hover:underline" onClick={onAddFolder}>
            {t('queue.addFolder')}
          </button>
        )}
        {onClear && items.length > 0 && (
          <button className="text-muted hover:text-body" onClick={onClear}>
            {t('queue.clear')}
          </button>
        )}
      </div>
    </div>
  );

  const emptyState = (
    <div
      onClick={onAdd}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed transition-colors ${
        isFill ? 'h-full' : 'py-9'
      } ${
        dragging
          ? 'border-brand-500 bg-brand-500/10 text-accent'
          : 'border-surface-600 bg-surface-800/40 text-muted hover:border-surface-500'
      }`}
    >
      <span className="text-3xl">⬇</span>
      <span className="text-sm font-medium">{t('drop.title')}</span>
      <span className="text-xs text-faint">{t('drop.hint')}</span>
    </div>
  );

  const listBody = (
    <>
      {items.map((item) => {
        const p = progress[item.id];
        const failed = item.status === 'error';
        const params = paramsFor(item);
        const noop = mode !== 'expert' && item.decision?.action === 'no-op';
        const est = estimateForItem(item, params);

        return (
          <div
            key={item.id}
            data-queue-item
            onClick={() => onSelect?.(item.id)}
            className={`card cursor-pointer p-3 transition-colors ${
              selectedId === item.id ? 'border-brand-500' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-strong">
                    🎬 {baseName(item.input)}
                  </span>
                  <StatusChip status={item.status} />
                </div>
                <div className="mt-0.5 text-xs text-faint">
                  {item.source.width}×{item.source.height}（
                  {resolutionLabel(item.source.width, item.source.height)}） · {item.source.fps}fps ·{' '}
                  {formatBitrate(item.source.bitrateMbps)} · {codecLabel(item.source.codec)} ·{' '}
                  {formatDuration(item.source.durationSec)} ·{' '}
                  {formatSize(item.source.fileSizeBytes)} · {item.source.hasAudio ? '🔊' : '🔇'}
                </div>
                {failed ? (
                  <p className="mt-1 text-xs text-err">{item.error}</p>
                ) : noop ? (
                  <p className="mt-1 text-xs text-muted">
                    ⚠ {t('queue.noTranscode')}
                  </p>
                ) : params ? (
                  <p className="mt-1 text-xs text-accent">
                    → {params.resolution}p / {params.fps}fps /{' '}
                    {params.bitrateMbps ? `${params.bitrateMbps}Mbps` : `CRF ${params.crf}`} ·{' '}
                    {codecLabel(params.codec)} · {params.container.toUpperCase()}
                    {params.hwCodec ? ` · ${params.hwCodec}` : ''}
                    {params.capped ? t('queue.capped') : ''}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {est && (
                  <div className="text-right" title={est.detail}>
                    <div className="text-[11px] text-faint">
                      {est.estimated ? t('queue.estOutput') : t('queue.sourceFile')}
                    </div>
                    <div className="text-sm font-medium text-strong">
                      {est.estimated && '≈ '}
                      {formatSize(est.bytes)}
                    </div>
                  </div>
                )}
                {onRemove && (
                  <button
                    className="text-xs text-faint hover:text-err"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(item.id);
                    }}
                  >
                    {t('queue.remove')}
                  </button>
                )}
              </div>
            </div>
            {item.status !== 'done' && (item.status === 'running' || p) && (
              <div className="mt-2">
                <ProgressBar progress={p} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  if (isFill) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        {header}
        <div
          className={`min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 transition-shadow ${
            dragging ? 'rounded-xl ring-2 ring-brand-500' : ''
          }`}
        >
          {items.length === 0 ? emptyState : listBody}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {header}
      <div
        className={`space-y-2 overflow-y-auto pr-1 transition-shadow ${
          dragging ? 'rounded-xl ring-2 ring-brand-500' : ''
        }`}
        style={items.length === 0 ? undefined : { maxHeight: CAPPED_MAX_HEIGHT }}
      >
        {items.length === 0 ? emptyState : listBody}
      </div>
    </div>
  );
}
