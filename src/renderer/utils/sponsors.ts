import alipayQr from '../assets/alipay.jpg';
import wechatQr from '../assets/wechat.png';

export type SponsorId = 'paypal' | 'wechat' | 'alipay';

export interface SponsorChannel {
  id: SponsorId;
  /** 外部赞助链接（http/https）。点击后在系统默认浏览器打开 */
  url?: string;
  /** 收款码图片（微信 / 支付宝） */
  qr?: string;
  /** 账号 / 收款说明（可选）：填写后页面会显示「复制」按钮 */
  account?: string;
  /** 图标底色（十六进制） */
  color: string;
  /** 图标内显示的文字 / 符号 */
  glyph: string;
}

/**
 * 赞助渠道配置
 * ------------------------------------------------------------------
 * 微信 / 支付宝收款码已放在 src/renderer/assets/（wechat.png / alipay.jpg）。
 * 如需替换收款码，直接覆盖对应图片即可；如需更换账号说明，填写 account 字段。
 * PayPal 链接为占位示例，请替换为你自己的地址。
 */
export const SPONSORS: SponsorChannel[] = [
  {
    id: 'paypal',
    url: 'https://paypal.me/geniusjees',
    color: '#00457C',
    glyph: 'P'
  },
  {
    id: 'wechat',
    qr: wechatQr,
    // account: 'your-wechat-id', // 可选：填写微信号后，页面会显示一键复制
    color: '#07C160',
    glyph: '微'
  },
  {
    id: 'alipay',
    qr: alipayQr,
    // account: 'your-alipay-account', // 可选：填写支付宝账号后，页面会显示一键复制
    color: '#1677FF',
    glyph: '支'
  }
];
