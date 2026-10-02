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

        // AWJ v3 (Horizon 1) — additive only, every value falls back to today's
        // existing variable. Using these utility classes unconditionally in JSX is
        // therefore safe: gate-off (no html[data-awj-ui="3"]) resolves to current
        // colors byte-for-byte; gate-on resolves to the new --awj-* values. Names
        // follow design-system/v3/TOKEN_REFERENCE.md §9 loosely (that table is
        // explicitly non-binding); values come from design-system/tokens/awj.tokens.json.
        desk: 'var(--awj-surface-desk, var(--background))',
        paper: 'var(--awj-surface-paper, var(--surface))',
        band: 'var(--awj-surface-band, var(--surface))',
        sunken: 'var(--awj-surface-sunken, var(--background))',
        outcome: 'var(--awj-surface-outcome, var(--text))',
        'brand-soft': 'var(--awj-brand-soft, var(--primary-soft))',
        hairline: 'var(--awj-border-hairline, var(--border))',
        strong: 'var(--awj-border-strong, var(--border))',
        control: 'var(--awj-border-control, var(--muted))',
        'primary-ink': 'var(--awj-text-primary, var(--text))',
        secondary: 'var(--awj-text-secondary, var(--muted))',
        tertiary: 'var(--awj-text-tertiary, var(--muted))',
        hover: 'var(--awj-state-hover, var(--primary-soft))',
        selected: 'var(--awj-state-selected, var(--primary-soft))',
        focus: 'var(--awj-state-focus-ring, var(--primary))',
        shell: {
          DEFAULT: 'var(--awj-shell-bg, var(--surface))',
          fg: 'var(--awj-shell-fg, var(--text))',
          muted: 'var(--awj-shell-fg-muted, var(--muted))',
          line: 'var(--awj-shell-line, var(--border))',
          hover: 'var(--awj-shell-hover, var(--primary-soft))',
          active: 'var(--awj-shell-active-bg, var(--primary-soft))',
          'active-fg': 'var(--awj-shell-active-fg, var(--primary))',
          apex: 'var(--awj-shell-apex, var(--primary))',
          field: 'var(--awj-shell-field-bg, var(--background))',
          'field-line': 'var(--awj-shell-field-line, var(--border))',
        },
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
        // AWJ v3 — additive, distinct namespace from the App Builder `canvas` key
        // above (16px "canvas" radius from TOKEN_REFERENCE.md §6 is intentionally
        // not mapped here in H1 to avoid any naming ambiguity with App-Builder canvas).
        control: 'var(--awj-radius-control, 0.375rem)',
        surface: 'var(--awj-radius-surface, 0.5rem)',
        float: 'var(--awj-radius-float, 0.75rem)',
      },
      boxShadow: {
        // AWJ v3 — additive. Falls back to `none`, matching today's flat surfaces.
        raised: 'var(--awj-elevation-1, none)',
        docked: 'var(--awj-elevation-2, none)',
        float: 'var(--awj-elevation-3, none)',
      },
    },
  },
  plugins: [],
} satisfies Config;
