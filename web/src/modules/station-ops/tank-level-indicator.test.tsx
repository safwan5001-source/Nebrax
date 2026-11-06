// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { afterEach, describe, expect, it } from 'vitest';
import { renderIntl, type TestLocale } from '@/test-utils/intl';
import { TankLevelIndicator } from './tank-level-indicator';
import type { TankLevelInput } from './tank-level';

afterEach(cleanup);

const ready = (input: TankLevelInput, tankName = 'Tank-1') => ({ state: 'ready' as const, input, tankName, timeZone: 'Asia/Riyadh' });
const CAP = 34_000_000; // 34,000 L

function mount(props: Parameters<typeof TankLevelIndicator>[0], locale: TestLocale = 'ar') {
  const view = renderIntl(<div dir={locale === 'ar' ? 'rtl' : 'ltr'}><TankLevelIndicator {...props} /></div>, locale);
  return view;
}

describe('labels communicate number AND status (never color alone)', () => {
  it.each([
    ['ar', 18_700_000, '55% — جيد', 'healthy'],
    ['ar', 11_900_000, '35% — متابعة', 'monitor'],
    ['ar', 4_760_000, '14% — منخفض', 'low'],
    ['en', 18_700_000, '55% — Good', 'healthy'],
    ['en', 11_900_000, '35% — Monitor', 'monitor'],
    ['en', 4_760_000, '14% — Low', 'low'],
  ] as const)('%s %i mL ⇒ "%s"', (locale, level, text, band) => {
    const { container } = mount(ready({ levelMilliliters: level, capacityMilliliters: CAP }), locale);
    expect(screen.getByText(text)).toBeTruthy();
    expect(container.querySelector('[data-tank-level="ok"]')?.getAttribute('data-band')).toBe(band);
  });

  it('shows liters of capacity with Latin digits in Arabic too', () => {
    mount(ready({ levelMilliliters: 18_700_000, capacityMilliliters: CAP }), 'ar');
    expect(screen.getByText('18,700 من 34,000 لتر')).toBeTruthy();
  });

  it('exact 20% and 50% are "monitor", just above 50% is "good"', () => {
    mount(ready({ levelMilliliters: 17_000_000, capacityMilliliters: CAP }));
    expect(screen.getByText('50% — متابعة')).toBeTruthy();
    cleanup();
    mount(ready({ levelMilliliters: 17_000_340, capacityMilliliters: CAP }));
    expect(screen.getByText('50.01% — جيد')).toBeTruthy();
  });
});

describe('meter semantics and provenance', () => {
  it('exposes role=meter with value, status, units and provenance in one accessible text', () => {
    mount(ready({ levelMilliliters: 18_700_000, capacityMilliliters: CAP, source: 'physical', measuredAt: '2026-11-06T08:30:00Z' }));
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-label')).toBe('منسوب الخزان — Tank-1');
    expect(meter.getAttribute('aria-valuenow')).toBe('55');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    const text = meter.getAttribute('aria-valuetext') ?? '';
    expect(text).toContain('55% — جيد');
    expect(text).toContain('18,700 من 34,000 لتر');
    expect(text).toContain('قياس يدوي');
    expect(text).toContain('آخر تحديث');
  });

  it('shows no provenance or timestamp when the contract did not declare them (never "actual"/"live")', () => {
    const { container } = mount(ready({ levelMilliliters: 18_700_000, capacityMilliliters: CAP }));
    expect(container.textContent).not.toMatch(/آخر تحديث|قياس|رصيد دفتري|تقديري|مباشر|فعلي/);
  });

  it.each([
    ['atg', 'قياس آلي (ATG)'], ['book', 'رصيد دفتري'], ['estimated', 'تقديري'],
  ] as const)('labels %s source accurately', (source, label) => {
    mount(ready({ levelMilliliters: 18_700_000, capacityMilliliters: CAP, source }));
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('an invalid timestamp is omitted rather than rendered as junk', () => {
    const { container } = mount(ready({ levelMilliliters: 18_700_000, capacityMilliliters: CAP, measuredAt: 'not-a-date' }));
    expect(container.textContent).not.toContain('آخر تحديث');
  });

  it('fill width equals the exact percent', () => {
    const { container } = mount(ready({ levelMilliliters: 18_700_000, capacityMilliliters: CAP }));
    expect((container.querySelector('[data-fill]') as HTMLElement).style.width).toBe(`${(18_700_000 / CAP) * 100}%`);
  });
});

describe('non-ok states are explicit and never fabricate a bar', () => {
  it.each([
    ['ar', 'المستوى غير متاح'], ['en', 'Level unavailable'],
  ] as const)('missing level (%s) ⇒ "%s", no meter, no percent', (locale, text) => {
    const { container } = mount(ready({ levelMilliliters: null, capacityMilliliters: CAP }), locale);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(container.textContent).not.toMatch(/%/);
  });

  it.each([
    [{ levelMilliliters: -5, capacityMilliliters: CAP }, 'قيمة المنسوب غير صالحة.'],
    [{ levelMilliliters: 5, capacityMilliliters: 0 }, 'سعة الخزان غير صالحة للمقارنة.'],
    [{ levelMilliliters: 5, capacityMilliliters: CAP, levelUnit: 'L' }, 'وحدة المنسوب لا تطابق وحدة السعة.'],
  ] as const)('invalid input %# explains why', (value, reason) => {
    mount(ready(value));
    expect(screen.getByText('المستوى غير متاح')).toBeTruthy();
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('over capacity is flagged as anomalous with raw amounts, no meter and no 100%', () => {
    const { container } = mount(ready({ levelMilliliters: 36_000_000, capacityMilliliters: CAP }));
    expect(screen.getByText('المنسوب يتجاوز السعة')).toBeTruthy();
    expect(screen.getByText('36,000 من 34,000 لتر')).toBeTruthy();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(container.textContent).not.toContain('100%');
  });

  it('loading is a labelled busy status; error is an alert', () => {
    mount({ state: 'loading' });
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('جارٍ تحميل المنسوب')).toBeTruthy();
    cleanup();
    mount({ state: 'error' });
    expect(screen.getByRole('alert').textContent).toContain('تعذّر تحميل المنسوب');
  });
});

describe('tokens, motion, RTL', () => {
  const dir = join(process.cwd(), 'src/modules/station-ops');
  const source = readFileSync(join(dir, 'tank-level-indicator.tsx'), 'utf8');

  it('uses semantic tokens only (no hard-coded colors)', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    for (const token of ['text-positive', 'text-warning', 'text-negative', 'bg-positive', 'bg-warning', 'bg-negative']) expect(source).toContain(token);
  });

  it('has no transition/animation, so a static snapshot never looks like a live feed and reduced motion is moot', () => {
    expect(source).not.toMatch(/transition|animate-|duration-|@keyframes/);
  });

  it('uses logical (RTL-safe) utilities only', () => {
    const classes = [...source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? '');
    for (const value of classes) expect(` ${value} `).not.toMatch(/\s-?(?:m[lr]|p[lr]|left|right|text-left|text-right|border-[lr]|rounded-[lr])(?:-[\w[\].]+)?\s/);
  });

  it('fill starts at the inline start in both directions (block child of the track, no physical offsets)', () => {
    for (const locale of ['ar', 'en'] as const) {
      const { container } = mount(ready({ levelMilliliters: 18_700_000, capacityMilliliters: CAP }), locale);
      expect((container.querySelector('[data-fill]') as HTMLElement).style.getPropertyValue('left')).toBe('');
      expect((container.querySelector('[data-fill]') as HTMLElement).style.getPropertyValue('right')).toBe('');
      cleanup();
    }
  });

  it('is isolated: imports no data/network modules', () => {
    for (const file of ['tank-level-indicator.tsx', 'tank-level.ts']) {
      const text = readFileSync(join(process.cwd(), 'src/modules/station-ops', file), 'utf8');
      expect(text, file).not.toMatch(/from '(?:\.\/|@\/lib\/)(?:data|read-client|write-client|api|use-scoped-query)'/);
      expect(text, file).not.toMatch(/\bapi\(|fetch\(/);
    }
  });
});

describe('accessibility (axe)', () => {
  it.each(['ar', 'en'] as const)('no violations for ok / unavailable / over-capacity (%s)', async (locale) => {
    for (const value of [
      { levelMilliliters: 18_700_000, capacityMilliliters: CAP, source: 'atg' as const, measuredAt: '2026-11-06T08:30:00Z' },
      { levelMilliliters: null, capacityMilliliters: CAP },
      { levelMilliliters: 36_000_000, capacityMilliliters: CAP },
    ]) {
      const { container } = mount(ready(value), locale);
      expect((await axe(container)).violations).toEqual([]);
      cleanup();
    }
  });
});
