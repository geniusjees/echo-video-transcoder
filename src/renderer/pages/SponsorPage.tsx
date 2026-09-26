import { useState } from 'react';
import { useT } from '../i18n';
import { SPONSORS, type SponsorChannel } from '../utils/sponsors';

/**
 * 赞助页：展示赞助渠道 + 免责说明。
 * 渠道地址在 `src/renderer/utils/sponsors.ts` 中预留（占位），替换即可生效。
 */
export default function SponsorPage() {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);

  const openLink = (url: string) => {
    void window.api.openExternal(url);
  };

  const copyAccount = async (id: string, account: string) => {
    const ok = await window.api.clipboardWrite(account);
    if (ok) {
      setCopied(id);
      setTimeout(() => setCopied((cur) => (cur === id ? null : cur)), 2000);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* 头部介绍 */}
      <div className="card space-y-2">
        <h2 className="text-base font-semibold text-strong">{t('sponsor.title')}</h2>
        <p className="text-sm leading-relaxed text-body">{t('sponsor.subtitle')}</p>
      </div>

      {/* 赞助渠道 */}
      <div className="grid gap-4 sm:grid-cols-2">
        {SPONSORS.map((ch) => (
          <SponsorCard
            key={ch.id}
            channel={ch}
            name={t(`sponsor.${ch.id}`)}
            copied={copied === ch.id}
            onOpen={openLink}
            onCopy={copyAccount}
          />
        ))}
      </div>

      {/* 免责说明 */}
      <div className="card space-y-2 border-warnline bg-warn-bg">
        <h3 className="text-sm font-semibold text-warn">{t('sponsor.disclaimerTitle')}</h3>
        <p className="text-xs leading-relaxed text-warn">{t('sponsor.disclaimer')}</p>
      </div>

      <p className="pb-2 text-center text-xs text-muted">{t('sponsor.thanks')}</p>
    </div>
  );
}

interface CardProps {
  channel: SponsorChannel;
  name: string;
  copied: boolean;
  onOpen: (url: string) => void;
  onCopy: (id: string, account: string) => void;
}

function SponsorCard({ channel, name, copied, onOpen, onCopy }: CardProps) {
  const t = useT();

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: channel.color }}
          aria-hidden
        >
          {channel.glyph}
        </span>
        <span className="text-sm font-medium text-strong">{name}</span>
      </div>

      {channel.url && (
        <div className="flex items-center gap-2">
          <code className="mono min-w-0 flex-1 truncate text-xs text-muted" title={channel.url}>
            {channel.url}
          </code>
          <button className="btn-primary shrink-0" onClick={() => onOpen(channel.url!)}>
            {t('sponsor.open')}
          </button>
        </div>
      )}

      {channel.account && (
        <div className="flex items-center gap-2">
          <code className="mono min-w-0 flex-1 truncate text-xs text-muted" title={channel.account}>
            {t('sponsor.account')}：{channel.account}
          </code>
          <button
            className="btn-ghost shrink-0"
            onClick={() => onCopy(channel.id, channel.account!)}
          >
            {copied ? t('sponsor.copied') : t('sponsor.copy')}
          </button>
        </div>
      )}

      {/* 收款码（微信 / 支付宝）——未配置时展示占位框 */}
      {(channel.id === 'wechat' || channel.id === 'alipay') &&
        (channel.qr ? (
          <img
            src={channel.qr}
            alt={name}
            className="mx-auto h-40 w-40 rounded-lg border border-surface-600 object-contain"
          />
        ) : (
          <div className="mx-auto flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-surface-500 bg-surface-700/50 text-center">
            <span className="text-2xl">▢</span>
            <span className="px-3 text-[11px] leading-tight text-faint">
              {t('sponsor.qrPlaceholder')}
            </span>
          </div>
        ))}
    </div>
  );
}
