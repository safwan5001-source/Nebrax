import type { Config } from 'tailwindcss';

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
        border: 'var(--border)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          soft: 'var(--primary-soft)',
          foreground: 'var(--primary-foreground)',
        },
        positive: 'var(--positive)',
        negative: 'var(--negative)',
        warning: 'var(--warning)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        // APP-BUILDER-22: a merchant's `theme.tokens.radius` choice needs a
        // rendering target in the App Builder canvas. `DEFAULT` above stays
        // a fixed literal on purpose — it backs the bare `rounded` class
        // used across the entire app (dashboard, invoices, HR, ...), so
        // making it var-driven would break every screen outside the
        // Builder wherever `--canvas-radius` isn't set. `canvas` is an
        // additive, separately-named scale value: `rounded-canvas` falls
        // back to the same `0.5rem` when unset, so it changes nothing
        // anywhere it isn't explicitly used.
        canvas: 'var(--canvas-radius, 0.5rem)',
      },
    },
  },
  plugins: [],
} satisfies Config;
