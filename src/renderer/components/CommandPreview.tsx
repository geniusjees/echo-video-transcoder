import { useT } from '../i18n';

interface Props {
  command?: string;
  commands?: string[];
  open?: boolean;
  onToggle?: () => void;
}

/** FFmpeg 命令预览（折叠，C7 / config.advanced.showCommandPreview） */
export default function CommandPreview({ command, commands, open, onToggle }: Props) {
  const t = useT();
  const list = commands ?? (command ? [command] : []);
  if (!list.length) return null;

  return (
    <div className="card p-0">
      <button
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-body"
        onClick={onToggle}
      >
        <span>{t('cmd.title')}</span>
        <span className="text-xs text-faint">
          {open ? `${t('cmd.collapse')} ▲` : `${t('cmd.expand')} ▼`}
        </span>
      </button>
      {open && (
        <div className="max-h-64 overflow-auto border-t border-surface-600 bg-surface-900/60 p-3">
          {list.map((c, i) => (
            <pre
              key={i}
              className="mono mb-2 whitespace-pre-wrap break-all text-xs leading-relaxed text-body"
            >
              {list.length > 1 ? `# ${t('cmd.step')} ${i + 1}\nffmpeg ${c}` : c}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}
