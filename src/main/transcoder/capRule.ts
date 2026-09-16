/**
 * 封顶规则（C6）
 * 实现已下沉到 `@shared/params`（渲染进程需要同步推导体积预估），此处仅做转发。
 */
export {
  applyCaps,
  capBitrate,
  capFps,
  capResolution,
  round1,
  type CapItem
} from '@shared/params';
