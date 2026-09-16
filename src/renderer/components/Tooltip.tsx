import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** 悬停时显示的内容 */
  content: ReactNode;
  children: ReactNode;
  /** 浮层宽度（px） */
  width?: number;
}

/**
 * 轻量 Tooltip：使用 fixed 定位 + Portal，避免被滚动容器裁剪
 */
export default function Tooltip({ content, children, width = 300 }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    const top = r.bottom + 8;
    setPos({ top, left });
  };

  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      className="relative inline-flex items-center align-middle"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
            className="pointer-events-none z-[9999] rounded-lg border border-surface-600 bg-surface-800 px-3 py-2 text-xs leading-relaxed text-body shadow-xl"
          >
            {content}
          </div>,
          document.body
        )}
    </span>
  );
}

/** 小圆形信息图标，常用于悬挂 tooltip */
export function InfoDot({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full border border-surface-500 text-[10px] text-faint ${className}`}
    >
      ?
    </span>
  );
}
