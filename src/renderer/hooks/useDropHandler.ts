import { useEffect, useRef } from 'react';
import { useDropStore } from '../stores/dropStore';

/**
 * 注册当前页面的拖拽处理器。
 * 由于 App 只渲染激活的页面，全局 drop 事件会派发给唯一注册的处理器（§13.1）。
 */
export function useDropHandler(handler: (paths: string[]) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  const setHandler = useDropStore((s) => s.setHandler);

  useEffect(() => {
    setHandler((paths) => ref.current(paths));
    return () => setHandler(null);
  }, [setHandler]);
}
