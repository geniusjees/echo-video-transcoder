export function formatDuration(sec: number): string {
  if (!sec || sec < 0) return '--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatSize(bytes?: number): string {
  if (!bytes) return '-';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function formatBitrate(mbps?: number): string {
  if (typeof mbps !== 'number' || !isFinite(mbps)) return '未知';
  return `${mbps} Mbps`;
}

export function resolutionLabel(width: number, height: number): string {
  if (!height) return '未知';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K/1440p';
  return `${height}p`;
}

export function codecLabel(codec: string): string {
  const map: Record<string, string> = {
    hevc: 'H.265/HEVC',
    h265: 'H.265/HEVC',
    h264: 'H.264/AVC',
    avc: 'H.264/AVC',
    av1: 'AV1',
    vp9: 'VP9',
    mpeg4: 'MPEG-4',
    copy: '复制流'
  };
  return map[codec?.toLowerCase()] ?? codec ?? '未知';
}

export function hwLabel(kind?: string): string {
  const map: Record<string, string> = {
    nvenc: 'NVIDIA NVENC',
    qsv: 'Intel QuickSync',
    amf: 'AMD AMF',
    videotoolbox: 'VideoToolbox',
    'videotoolbox-mps': 'Apple MPS (VideoToolbox)',
    vaapi: 'VAAPI',
    software: '软件编码'
  };
  return kind ? map[kind] ?? kind : '未侦测';
}

export function baseName(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}
