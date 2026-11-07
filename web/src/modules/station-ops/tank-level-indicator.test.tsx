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
    ['atg', 'قياس آلي (ATG)'], ['estimated', 'تقديري'],
  ] as const)('labels %s source accurately', (source, label) => {
    mount(ready({ levelMilliliters: 18_700_000, capacityMilliliters: CAP, source }));
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('labels the book source as a title above the level (not repeated as a provenance line)', () => {
    const { container } = mount(ready({ levelMilliliters: 18_700_000, capacityMilliliters: CAP, source: 'book' }));
    expect(screen.getAllByText('الرصيد الدفتري')).toHaveLength(1);
    expect(container.querySelector('[data-tank-level="ok"] > p')?.textContent).toBe('الرصيد الدفتري');
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).not.toContain('رصيد دفتري');
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

describe('TANK-LEVEL-P2 — book balance states from the server contract', () => {
  const REASONS: Array<[string, string, string]> = [
    ['multi_tank', 'الرصيد غير متاح لكل خزان على حدة؛ يوجد أكثر من خزان يغذّي المخزون نفسه.', "Balance isn't available per tank: more than one tank feeds the same stock."],
    ['no_stock_record', 'لا يوجد سجل رصيد لهذا المنتج في المخزن بعد.', 'There is no stock record for this product in the warehouse yet.'],
    ['ambiguous_stock_record', 'يوجد أكثر من سجل رصيد لهذا المنتج؛ تعذّر تحديد الرصيد.', "More than one stock record exists for this product; the balance can't be determined."],
    ['invalid_stock_record', 'سجل الرصيد غير صالح ويحتاج إلى مراجعة.', 'The stock record is invalid and needs review.'],
    ['no_warehouse', 'المحطة غير مرتبطة بمخزن.', "The station isn't linked to a warehouse."],
    ['tank_inactive', 'الخزان معطّل.', 'The tank is inactive.'],
    ['unit_mismatch', 'وحدة المنتج لا تتوافق مع المليلتر/اللتر.', "The product unit doesn't match millilitres/litres."],
    ['invalid_configuration', 'إعداد الخزان أو المنتج غير مكتمل.', 'The tank or product setup is incomplete.'],
    ['not_provided', 'لم يُرسل الخادم بيانات الرصيد.', "The server didn't send balance data."],
    ['invalid_data', 'بيانات الرصيد المستلمة غير صالحة.', "The balance data received isn't valid."],
    ['unknown_reason', 'لا يتوفر رصيد لهذا الخزان.', 'No balance is available for this tank.'],
  ];

  it.each(REASONS)('%s ⇒ an explicit message in ar and en, with no meter, no percent and no number', (reason, ar, en) => {
    for (const [locale, text, title] of [['ar', ar, 'المستوى غير متاح'], ['en', en, 'Level unavailable']] as const) {
      const { container } = mount({ state: 'unavailable', reason: reason as never }, locale);
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.queryByRole('meter')).toBeNull();
      expect(container.querySelector('[data-fill]')).toBeNull();
      expect(container.textContent).not.toMatch(/%|\d/);
      expect(container.querySelector('[data-tank-level="unavailable"]')?.getAttribute('data-reason')).toBe(reason);
      cleanup();
    }
  });

  it('multi_tank says the balance is not available per tank (not a generic failure)', () => {
    mount({ state: 'unavailable', reason: 'multi_tank' });
    expect(screen.getByText(/غير متاح لكل خزان على حدة/)).toBeTruthy();
  });

  it('a zero balance is a real 0% (empty bar, low) — never confused with unavailable', () => {
    const { container } = mount(ready({ levelMilliliters: 0, capacityMilliliters: CAP, source: 'book' }));
    expect(screen.getByText('0% — منخفض')).toBeTruthy();
    expect(container.querySelector('[data-tank-level="unavailable"]')).toBeNull();
    expect((container.querySelector('[data-fill]') as HTMLElement).style.width).toBe('0%');
    expect(screen.getByText('0 من 34,000 لتر')).toBeTruthy();
  });

  it('over capacity stays visible as an anomaly with both numbers (and the book title), never clamped', () => {
    const { container } = mount(ready({ levelMilliliters: 36_000_000, capacityMilliliters: CAP, source: 'book' }));
    expect(screen.getByText('المنسوب يتجاوز السعة')).toBeTruthy();
    expect(screen.getByText('36,000 من 34,000 لتر')).toBeTruthy();
    expect(screen.getByText('الرصيد الدفتري')).toBeTruthy();
    expect(container.querySelector('[data-fill]')).toBeNull();
    expect(container.textContent).not.toContain('100%');
  });

  it('never shows an update time for a book balance even if one is supplied', () => {
    const { container } = mount(ready({ levelMilliliters: 18_700_000, capacityMilliliters: CAP, source: 'book', measuredAt: null }));
    expect(container.textContent).not.toMatch(/آخر تحديث|Last updated/);
  });
});

describe('TANK-LEVEL-P2 — minimum level alert (separate, display only)', () => {
  const alert = (container: HTMLElement) => container.querySelector('[data-minimum-alert]');

  it('appears when the balance is below the configured minimum, in addition to (not instead of) the band', () => {
    const { container } = mount({ ...ready({ levelMilliliters: 4_000_000, capacityMilliliters: CAP, source: 'book' }), minimumLevelMilliliters: 5_000_000 });
    expect(alert(container)?.textContent).toBe('تنبيه: الرصيد أقل من الحد الأدنى المضبوط للخزان (5,000 لتر).');
    expect(screen.getByText('12% — منخفض')).toBeTruthy();
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toContain('الحد الأدنى');
  });

  it('is independent from the 20/50 bands: a healthy-looking level can still be below its own minimum', () => {
    const { container } = mount({ ...ready({ levelMilliliters: 20_000_000, capacityMilliliters: CAP, source: 'book' }), minimumLevelMilliliters: 25_000_000 });
    expect(container.querySelector('[data-band]')?.getAttribute('data-band')).toBe('healthy'); // 58.8%
    expect(alert(container)).not.toBeNull();
  });

  it.each([
    ['equal to the minimum', 5_000_000, 5_000_000],
    ['above the minimum', 6_000_000, 5_000_000],
    ['minimum unset (null)', 100, null],
    ['minimum zero (system default, unset)', 100, 0],
    ['minimum undefined', 100, undefined],
    ['minimum invalid (NaN)', 100, Number.NaN],
  ])('does not appear when %s', (_name, level, minimum) => {
    const { container } = mount({ ...ready({ levelMilliliters: level, capacityMilliliters: CAP, source: 'book' }), minimumLevelMilliliters: minimum as number | null | undefined });
    expect(alert(container)).toBeNull();
  });

  it('is not shown when there is no level at all, or for an anomalous over-capacity value', () => {
    expect(alert(mount({ state: 'unavailable', reason: 'multi_tank' }).container)).toBeNull();
    cleanup();
    expect(alert(mount({ ...ready({ levelMilliliters: 36_000_000, capacityMilliliters: CAP, source: 'book' }), minimumLevelMilliliters: 5_000_000 }).container)).toBeNull();
  });

  it('is localized in English too', () => {
    const { container } = mount({ ...ready({ levelMilliliters: 1_000, capacityMilliliters: CAP, source: 'book' }), minimumLevelMilliliters: 5_000_000 }, 'en');
    expect(alert(container)?.textContent).toBe("Alert: the balance is below the tank's configured minimum level (5,000 L).");
  });
});

describe('TANK-LEVEL-P2 — millilitres to litres precision', () => {
  it.each([
    [1, '0.001'],
    [999, '0.999'],
    [1_000, '1'],
    [34_000_000, '34,000'],
    [18_700_001, '18,700.001'],
  ])('%i mL is shown as %s L exactly (integer arithmetic, Latin digits)', (ml, liters) => {
    mount(ready({ levelMilliliters: ml, capacityMilliliters: CAP, source: 'book' }));
    expect(screen.getByText(`${liters} من 34,000 لتر`)).toBeTruthy();
  });

  it('the percent is level ÷ capacity (not safe capacity): 17,000,000 of 34,000,000 mL is exactly 50%', () => {
    mount(ready({ levelMilliliters: 17_000_000, capacityMilliliters: CAP, source: 'book' }));
    expect(screen.getByText('50% — متابعة')).toBeTruthy();
  });
});
