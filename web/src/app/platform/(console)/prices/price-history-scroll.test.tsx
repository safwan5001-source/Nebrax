/* @vitest-environment jsdom */
import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatRiyal } from '@/lib/money';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import PlatformPricesPage from './page';

// H1-N1: the price-history table scrolls horizontally at large text / narrow widths; a keyboard user needs a way in,
// but only while it really scrolls. jsdom has no layout, so scrollWidth/clientWidth and ResizeObserver are driven here;
// real layout, real axe and real Tab/arrow scrolling are verified in the report (Chromium).
const { platformApi } = vi.hoisted(() => ({ platformApi: vi.fn() }));
let locale: 'en' | 'ar' = 'en';
let overflow = { scrollWidth: 0, clientWidth: 0 };
const observers: Array<() => void> = [];

function makeTranslator(lang: 'en' | 'ar') {
  return (key: string, values?: Record<string, string | number>) => {
    const text = ((lang === 'ar' ? ar : en) as unknown as Record<string, Record<string, unknown>>).platformPrices[key];
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
}
const translators = { en: makeTranslator('en'), ar: makeTranslator('ar') };
vi.mock('next-intl', () => ({ useTranslations: () => translators[locale] }));
const router = { replace: vi.fn(), push: vi.fn() }; // stable: the page's load effect depends on the router identity
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/platform-auth', () => ({ isPlatformAuthenticated: () => true }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {} }));

const price = (id: string, plan: string, amount: string, effective_on: string) => ({
  id, plan, currency: 'SAR', monthly_amount: amount, monthly_amount_minor: Math.round(Number(amount) * 100), effective_on, created_at: '2026-01-01T10:00:00+00:00',
});
const rows = () => ({
  data: [price('b', 'basic', '99.00', '2026-03-01'), price('p1', 'pro', '199.99', '2026-06-01'), price('p0', 'pro', '149.00', '2025-06-01')],
});
const t = (key: string) => translators[locale](key);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T09:00:00Z'));
  locale = 'en';
  overflow = { scrollWidth: 0, clientWidth: 0 };
  observers.length = 0;
  platformApi.mockReset();
  platformApi.mockResolvedValue(rows());
  // Only the history scroller (the `md:block` overflow container) reports a size; every other element measures 0.
  const isScroller = (el: Element) => el.className.toString().includes('md:block') && el.className.toString().includes('overflow-x-auto');
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return isScroller(this) ? overflow.scrollWidth : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return isScroller(this) ? overflow.clientWidth : 0; });
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { observers.push(cb); } observe() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Wait for the history table (the summary cards render first). */
async function settle(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('section[aria-labelledby="prices-history"] [aria-busy="false"] table')).toBeTruthy());
}

async function renderLoaded() {
  const utils = render(<PlatformPricesPage />);
  await screen.findAllByText(formatRiyal('199.99'));
  await settle(utils.container);
  return utils;
}
const scroller = (container: HTMLElement) => container.querySelector('section[aria-labelledby="prices-history"] div.md\\:block[class*="overflow-x-auto"]') as HTMLElement;

for (const lang of ['en', 'ar'] as const) {
  describe(`price history scroll region (${lang})`, () => {
    beforeEach(() => { locale = lang; });

    it('is a named, focusable region when the table really overflows', async () => {
      overflow = { scrollWidth: 920, clientWidth: 606 };
      const { container } = await renderLoaded();
      const region = scroller(container);
      await waitFor(() => expect(region.getAttribute('role')).toBe('region'));
      expect(region.getAttribute('tabindex')).toBe('0');
      expect(region.getAttribute('aria-label')).toBe(t('historyScrollRegion'));
      expect(screen.getByRole('region', { name: t('historyScrollRegion') })).toBe(region);
    });

    it('adds no tab stop and no role when the table fits', async () => {
      overflow = { scrollWidth: 686, clientWidth: 686 };
      const { container } = await renderLoaded();
      const region = scroller(container);
      expect(region.hasAttribute('tabindex')).toBe(false);
      expect(region.hasAttribute('role')).toBe(false);
      expect(region.hasAttribute('aria-label')).toBe(false);
    });

    it('its name differs from the section landmark (no duplicate landmark names) but names the same table', async () => {
      overflow = { scrollWidth: 920, clientWidth: 606 };
      await renderLoaded();
      await screen.findByRole('region', { name: t('historyScrollRegion') });
      const section = screen.getByRole('region', { name: t('history') });
      const region = screen.getByRole('region', { name: t('historyScrollRegion') });
      expect(section).not.toBe(region);
      expect(t('historyScrollRegion')).not.toBe(t('history'));
      expect(t('historyScrollRegion').startsWith(t('history'))).toBe(true);
    });
  });
}

describe('price history scroll region: keyboard, focus ring, single scroller', () => {
  it('Tab reaches the region only while it scrolls', async () => {
    overflow = { scrollWidth: 920, clientWidth: 606 };
    const { container, unmount } = await renderLoaded();
    const user = userEvent.setup();
    await waitFor(() => expect(scroller(container).getAttribute('tabindex')).toBe('0'));
    const region = scroller(container);
    let reached = false;
    for (let i = 0; i < 60 && !reached; i += 1) { await user.tab(); reached = document.activeElement === region; }
    expect(reached).toBe(true);
    unmount();

    overflow = { scrollWidth: 686, clientWidth: 686 };
    const second = await renderLoaded();
    const stops: Element[] = [];
    for (let i = 0; i < 40; i += 1) { await user.tab(); stops.push(document.activeElement as Element); }
    expect(stops).not.toContain(scroller(second.container));
  });

  it('shows a clear focus ring on the region and removes the default outline', async () => {
    overflow = { scrollWidth: 920, clientWidth: 606 };
    const { container } = await renderLoaded();
    await waitFor(() => expect(scroller(container).getAttribute('tabindex')).toBe('0'));
    const cls = scroller(container).className;
    expect(cls).toContain('focus-visible:ring-2');
    expect(cls).toContain('focus-visible:ring-primary');
    expect(cls).not.toContain('ring-primary/');
    expect(cls).toContain('focus-visible:outline-none');
  });

  it('the table wrapper does not scroll on its own, so the focusable region is the only scroller', async () => {
    overflow = { scrollWidth: 920, clientWidth: 606 };
    const { container } = await renderLoaded();
    const inner = scroller(container).querySelector('[data-awj-grid-scroll]') as HTMLElement;
    expect(inner.className).toContain('overflow-x-visible');
    expect(inner.className).not.toContain('overflow-x-auto');
  });

  it('follows resize: the stop appears when the table starts to overflow and goes away when it fits', async () => {
    overflow = { scrollWidth: 686, clientWidth: 686 };
    const { container } = await renderLoaded();
    expect(scroller(container).hasAttribute('tabindex')).toBe(false);
    overflow = { scrollWidth: 920, clientWidth: 350 };
    act(() => { observers.forEach((cb) => cb()); });
    expect(scroller(container).getAttribute('tabindex')).toBe('0');
    overflow = { scrollWidth: 686, clientWidth: 686 };
    act(() => { observers.forEach((cb) => cb()); });
    expect(scroller(container).hasAttribute('tabindex')).toBe(false);
  });
});

describe('price data is untouched', () => {
  it('keeps the column order and every value, currency and date, with or without the region', async () => {
    for (const o of [{ scrollWidth: 686, clientWidth: 686 }, { scrollWidth: 920, clientWidth: 350 }]) {
      overflow = o;
      const { container, unmount } = await renderLoaded();
      const heads = Array.from(container.querySelectorAll('section[aria-labelledby="prices-history"] thead th')).map((th) => th.textContent);
      expect(heads).toEqual([t('plan'), t('statusColumn'), t('price'), t('currency'), t('effectiveOn'), t('addedOn')]);
      const body = Array.from(container.querySelectorAll('section[aria-labelledby="prices-history"] tbody tr')).map((tr) => Array.from(tr.children).map((td) => td.textContent));
      expect(body).toHaveLength(3);
      expect(body.some((r) => r[0] === 'pro' && r[2] === formatRiyal('199.99') && r[3] === 'SAR' && r[4] === '2026-06-01' && r[5] === '2026-01-01')).toBe(true);
      expect(container.querySelectorAll('.md\\:hidden > div')).toHaveLength(3); // the mobile card list is unchanged
      unmount();
    }
  });
});

describe('other tables are not affected (H1-N1)', () => {
  it('Table with no wrapperProps still scrolls on its own wrapper and gains no role, tabindex or label', () => {
    const { container } = render(<Table><THead><TR><TH>A</TH></TR></THead><TBody><TR><TD>1</TD></TR></TBody></Table>);
    const wrapper = container.querySelector('[data-awj-grid-scroll]') as HTMLElement;
    expect(wrapper.className).toBe('w-full overflow-x-auto');
    for (const attr of ['role', 'tabindex', 'aria-label', 'aria-labelledby']) expect(wrapper.hasAttribute(attr)).toBe(false);
  });

  it('wrapperProps stay additive: an explicit className merges and other props pass through', () => {
    const { container } = render(<Table wrapperProps={{ className: 'rounded-md', 'data-x': '1' } as React.HTMLAttributes<HTMLDivElement>}><TBody><TR><TD>1</TD></TR></TBody></Table>);
    const wrapper = container.querySelector('[data-awj-grid-scroll]') as HTMLElement;
    expect(wrapper.className).toContain('overflow-x-auto');
    expect(wrapper.className).toContain('rounded-md');
    expect(wrapper.getAttribute('data-x')).toBe('1');
  });

  it('the shared Table primitive was not changed to add keyboard behaviour; the fix lives only in the prices page', () => {
    const root = path.resolve(__dirname, '../../../..');
    const table = fs.readFileSync(path.join(root, 'components/ui/table.tsx'), 'utf8');
    expect(table).not.toMatch(/tabIndex|useHorizontalOverflow|role:/);
    const consumers = ['app/platform/(console)/prices/page.tsx'];
    for (const rel of consumers) expect(fs.readFileSync(path.join(root, rel), 'utf8')).toMatch(/useHorizontalOverflow/);
  });
});
