import type { Config } from 'tailwindcss';

// منسوخ حرفياً من web/tailwind.config.ts — الفرق الوحيد هو `content` ليطابق
// مسارات هذه الحزمة المستقلة بدل مسارات تطبيق web/.
export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        surface: 'var(--surface)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        border: 'rgb(var(--border-channel) / <alpha-value>)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          soft: 'rgb(var(--primary-soft-channel) / <alpha-value>)',
          foreground: 'var(--primary-foreground)',
        },
        positive: 'rgb(var(--positive-channel) / <alpha-value>)',
        negative: 'rgb(var(--negative-channel) / <alpha-value>)',
        warning: 'rgb(var(--warning-channel) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
    },
  },
  plugins: [],
} satisfies Config;
