import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * تباين رموز Design System V2 (WCAG 2.2 AA) محسوب من ملف CSS نفسه — فلا تنفصل القيم المختبَرة عن المشحونة.
 * نص عادي ≥ 4.5:1، حدود عناصر التحكم (1.4.11) ≥ 3:1.
 */
const css = readFileSync(new URL('./fuel-ops.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
function luminance(hex: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const c = channel(hex, i) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function tint(fg: string, bg: string, alpha: number): string {
  const mixed = [0, 1, 2].map((i) => Math.round(channel(fg, i) * alpha + channel(bg, i) * (1 - alpha)));
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const themes = { light: block('[data-fuel-ops]'), dark: block('.dark [data-fuel-ops]') };

describe.each(Object.entries(themes))('V2 tokens — %s', (_name, t) => {
  it('defines the full semantic set', () => {
    for (const key of ['background', 'surface', 'text', 'muted', 'border', 'primary', 'primary-soft', 'primary-foreground', 'positive', 'negative', 'warning', 'fo-navy', 'fo-accent', 'fo-control', 'fo-on-navy', 'fo-on-navy-muted', 'fo-header-line', 'fo-header-hover', 'fo-logo-bg']) {
      expect(t[key], key).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each([
    ['text', 'background'], ['text', 'surface'], ['muted', 'background'], ['muted', 'surface'],
    ['primary', 'background'], ['primary', 'surface'], ['primary', 'primary-soft'], ['primary-foreground', 'primary'],
    ['positive', 'surface'], ['negative', 'surface'], ['warning', 'surface'], ['warning', 'background'],
  ])('%s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['positive', 'warning', 'negative'])('%s text on its own 15%% badge tint ≥ 4.5:1 (on surface and background)', (key) => {
    expect(contrast(t[key], tint(t[key], t.surface, 0.15))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t[key], tint(t[key], t.background, 0.15))).toBeGreaterThanOrEqual(4.5);
  });

  it('control borders are identifiable (≥ 3:1) on surface and background', () => {
    expect(contrast(t['fo-control'], t.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(t['fo-control'], t.background)).toBeGreaterThanOrEqual(3);
  });

  it('header: on-navy text (primary and muted) on navy, navy text on the accent fill', () => {
    expect(contrast(t['fo-on-navy'], t['fo-navy'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['fo-on-navy-muted'], t['fo-navy'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['fo-on-navy'], t['fo-header-hover'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['fo-navy'], t['fo-accent'])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('V2 token scope', () => {
  it('every rule is scoped under [data-fuel-ops] so no other screen is affected', () => {
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith('@'));
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(',')) expect(part.trim(), part).toContain('[data-fuel-ops]');
    }
  });
});
