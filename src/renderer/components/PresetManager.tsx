import { useEffect, useState } from 'react';
import type { ExpertOptions, Preset } from '@shared/types';
import { useConfigStore } from '../stores/configStore';
import { useT } from '../i18n';

interface Props {
  current: ExpertOptions;
  onApply: (options: ExpertOptions) => void;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 默认预设名：My preset 09-16 09:30（避免名称为空导致按钮不可用） */
function defaultPresetName(): string {
  const d = new Date();
  return `Preset ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 自定义预设：保存 / 应用 / 删除 / 导入 / 导出（C8） */
export default function PresetManager({ current, onApply }: Props) {
  const t = useT();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState(defaultPresetName);
  const [busy, setBusy] = useState(false);
  const setNotice = useConfigStore((s) => s.setNotice);

  const refresh = async () => {
    const list = (await window.api.configGet()).config.presets.custom ?? [];
    setPresets(list);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    const presetName = name.trim() || defaultPresetName();
    setBusy(true);
    try {
      await window.api.presetSave({ name: presetName, options: current });
      setNotice(t('preset.saved', { name: presetName }));
      setName(defaultPresetName());
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="mb-2 text-sm font-semibold text-strong">{t('preset.title')}</h3>
      <input
        className="input w-full"
        placeholder={t('preset.namePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      {/* 三个按钮单独占一行，避免长文案语言（如德语/葡萄牙语）挤压名称输入框 */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button className="btn-ghost px-2" onClick={save} disabled={busy}>
          {t('preset.save')}
        </button>
        <button
          className="btn-ghost px-2"
          disabled={busy}
          title={t('preset.exportTip')}
          onClick={async () => {
            setBusy(true);
            try {
              const ok = await window.api.presetExport({
                name: name.trim() || defaultPresetName(),
                options: current
              });
              if (ok) setNotice(t('preset.exported'));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('preset.exportCurrent')}
        </button>
        <button
          className="btn-ghost px-2"
          disabled={busy}
          onClick={async () => {
            const preset = await window.api.presetImport();
            if (preset) {
              setNotice(t('preset.imported', { name: preset.name }));
              await refresh();
            }
          }}
        >
          {t('preset.import')}
        </button>
      </div>

      <div className="mt-3 space-y-1.5">
        {presets.length === 0 && <p className="text-xs text-faint">{t('preset.empty')}</p>}
        {presets.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg border border-surface-600 px-3 py-2"
          >
            <span className="truncate text-sm text-body">{p.name}</span>
            <div className="flex shrink-0 gap-2 text-xs">
              <button className="text-accent hover:underline" onClick={() => onApply(p.options)}>
                {t('preset.apply')}
              </button>
              <button
                className="text-muted hover:underline"
                onClick={async () => {
                  const ok = await window.api.presetExport({ id: p.id, name: p.name });
                  if (ok) setNotice(t('preset.exported'));
                }}
              >
                {t('preset.export')}
              </button>
              <button
                className="text-err hover:underline"
                onClick={async () => {
                  setPresets(await window.api.presetDelete(p.id));
                }}
              >
                {t('preset.delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
