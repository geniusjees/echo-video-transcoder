/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主题相关（CSS 变量，随 .dark 切换）
        surface: {
          900: 'rgb(var(--c-surface-900) / <alpha-value>)',
          800: 'rgb(var(--c-surface-800) / <alpha-value>)',
          700: 'rgb(var(--c-surface-700) / <alpha-value>)',
          600: 'rgb(var(--c-surface-600) / <alpha-value>)',
          500: 'rgb(var(--c-surface-500) / <alpha-value>)'
        },
        brand: {
          400: 'rgb(var(--c-brand-400) / <alpha-value>)',
          500: 'rgb(var(--c-brand-500) / <alpha-value>)',
          600: 'rgb(var(--c-brand-600) / <alpha-value>)'
        },
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'on-brand': 'rgb(var(--c-on-brand) / <alpha-value>)',

        // 语义文字色
        strong: 'rgb(var(--c-text-strong) / <alpha-value>)',
        body: 'rgb(var(--c-text-body) / <alpha-value>)',
        muted: 'rgb(var(--c-text-muted) / <alpha-value>)',
        faint: 'rgb(var(--c-text-faint) / <alpha-value>)',

        // 语义状态色
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        'warn-strong': 'rgb(var(--c-warn-strong) / <alpha-value>)',
        'warn-bg': 'rgb(var(--c-warn-bg) / <alpha-value>)',
        warnline: 'rgb(var(--c-warnline) / <alpha-value>)',

        err: 'rgb(var(--c-err) / <alpha-value>)',
        'err-strong': 'rgb(var(--c-err-strong) / <alpha-value>)',
        'err-bg': 'rgb(var(--c-err-bg) / <alpha-value>)',
        'err-bg-strong': 'rgb(var(--c-err-bg-strong) / <alpha-value>)',
        errline: 'rgb(var(--c-errline) / <alpha-value>)',

        'ok-strong': 'rgb(var(--c-ok-strong) / <alpha-value>)',
        'ok-bg': 'rgb(var(--c-ok-bg) / <alpha-value>)',

        'info-strong': 'rgb(var(--c-info-strong) / <alpha-value>)',
        'info-bg': 'rgb(var(--c-info-bg) / <alpha-value>)'
      }
    }
  },
  plugins: []
};
