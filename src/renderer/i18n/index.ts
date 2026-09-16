import { create } from 'zustand';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import de from './locales/de.json';
import it from './locales/it.json';

/**
 * 轻量 i18n：文案全部放在 locales/*.json（flat key），
 * 未命中的 key 回退到英语，再回退到 key 本身。
 */

export const SUPPORTED = [
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
  'en',
  'fr',
  'es',
  'pt',
  'de',
  'it'
] as const;

export type LocaleCode = (typeof SUPPORTED)[number];

export const FALLBACK_LOCALE: LocaleCode = 'en';

const DICTS: Record<LocaleCode, Record<string, string>> = {
  'zh-CN': zhCN as Record<string, string>,
  'zh-TW': zhTW as Record<string, string>,
  ja: ja as Record<string, string>,
  ko: ko as Record<string, string>,
  en: en as Record<string, string>,
  fr: fr as Record<string, string>,
  es: es as Record<string, string>,
  pt: pt as Record<string, string>,
  de: de as Record<string, string>,
  it: it as Record<string, string>
};

/** 下拉框选项：用各自语言书写，方便用户识别 */
export const LANGUAGE_OPTIONS: { code: LocaleCode; label: string }[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' }
];

export function localeLabel(code: LocaleCode): string {
  return LANGUAGE_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

/**
 * 系统语言 → 支持列表的匹配
 * 例：zh-Hant-TW → zh-TW；zh-Hans-CN / zh-CN → zh-CN；pt-BR → pt；其它 → en
 */
export function resolveLocale(raw: string | undefined | null): LocaleCode {
  if (!raw) return FALLBACK_LOCALE;
  const tag = String(raw).replace(/_/g, '-').toLowerCase();
  const exact = SUPPORTED.find((c) => c.toLowerCase() === tag);
  if (exact) return exact;

  const [lang, ...rest] = tag.split('-');
  const hint = rest.join('-');

  if (lang === 'zh') {
    return /hant|tw|hk|mo/.test(hint) ? 'zh-TW' : 'zh-CN';
  }
  const byLang = SUPPORTED.find((c) => c.split('-')[0] === lang);
  return byLang ?? FALLBACK_LOCALE;
}

export type TranslateVars = Record<string, string | number>;

function translate(locale: LocaleCode, key: string, vars?: TranslateVars): string {
  const raw = DICTS[locale]?.[key] ?? DICTS[FALLBACK_LOCALE]?.[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m
  );
}

interface I18nState {
  /** 实际生效的语言 */
  locale: LocaleCode;
  /** 用户配置：'auto' = 跟随系统 */
  preference: string;
  /** 系统语言（来自主进程 app.getLocale()） */
  systemLocale: string;
  /** 系统语言匹配到的语言 */
  matched: LocaleCode;
  init: (systemLocale: string, preference?: string) => void;
  setPreference: (preference: string) => void;
}

export const useI18nStore = create<I18nState>((set, get) => ({
  locale: 'zh-CN',
  preference: 'auto',
  systemLocale: 'zh-CN',
  matched: 'zh-CN',

  init: (systemLocale, preference) => {
    const matched = resolveLocale(systemLocale);
    const pref = preference || get().preference || 'auto';
    set({
      systemLocale,
      matched,
      preference: pref,
      locale: pref === 'auto' ? matched : resolveLocale(pref)
    });
  },

  setPreference: (preference) => {
    const { matched, systemLocale } = get();
    set({
      preference,
      matched,
      systemLocale,
      locale: preference === 'auto' ? matched : resolveLocale(preference)
    });
  }
}));

/** 非组件环境（如 store 内写日志）可直接调用 */
export function t(key: string, vars?: TranslateVars): string {
  return translate(useI18nStore.getState().locale, key, vars);
}

/** 组件内使用：语言切换后自动重渲染 */
export function useT(): (key: string, vars?: TranslateVars) => string {
  const locale = useI18nStore((s) => s.locale);
  return (key, vars) => translate(locale, key, vars);
}
