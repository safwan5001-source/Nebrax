/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { ApplicationOverrideCard } from './application-override-card';
import { CommercialOperationsCard } from './commercial-operations-card';

// H15-08: the tenant detail page's two axe findings (select-name, scrollable-region-focusable).
const { platformApi } = vi.hoisted(() => ({ platformApi: vi.fn() }));
let locale: 'en' | 'ar' = 'en';

/** Real messages, resolved through the namespace path exactly as next-intl does (`a.b` namespaces, dotted keys). */
const cache = new Map<string, (key: string, values?: Record<string, string | number>) => string>();
/** Stable per (locale, namespace) like next-intl's: a fresh function each render would re-fire the cards' load effects forever. */
function translator(namespace: string) {
  const cacheKey = `${locale}:${namespace}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const fn = (key: string, values?: Record<string, string | number>) => {
    let node: unknown = locale === 'ar' ? ar : en;
    for (const part of `${namespace}.${key}`.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    if (typeof node !== 'string') return key;
    return node.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
  cache.set(cacheKey, fn);
  return fn;
}
vi.mock('next-intl', () => ({ useTranslations: (namespace: string) => translator(namespace), useLocale: () => locale }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {} }));

const app = (key: string, over: Record<string, unknown> = {}) => ({
  key, group: 'operations', maturity: 'built', mandatory: false, access: 'commercial', commercial_mode: 'inherit', override_grant_id: null,
  operational_status: 'enabled', effective_access: 'full', can_grant: true, can_revert: false, can_show: true, can_hide: true,
  skip_reasons: { grant: [], revert: [], show: [], hide: [] }, ...over,
});
const overrideSummary = () => ({
  applications: [
    app('fuel_stations.core', { access: 'commercial' }),
    app('crm.core', { access: 'operational' }),
    app('pos.core', { access: 'operational', maturity: 'coming_soon' }),
  ],
});
const commercialApplications = {
  applications: [{
    key: 'fuel_stations.core', group: 'operations', maturity: 'built', mandatory: false, dependencies: [], enabled: false, status: 'suspended', changed_at: null, reason: 'x',
    commercial: { availability: 'addon', source_count: 1, source_types: ['addon'], trial_until: null, cancels_at: null, expired: false },
    effective_access: 'full', dependency_status: 'not_applicable',
  }],
  commercial_summary: { current_plan: null, included_products: [], active_addons: [], trials: [], legacy_entitlements: [], ended_assignments: [] },
};
const catalog = { products: [{ id: 'fuel-product', code: 'fuel-stations', name: 'Fuel Stations', versions: [{ id: 'fuel-version', version: 1, published_at: '2026-08-01T00:00:00Z', retired_at: null, capabilities: ['fuel_stations.core'] }] }], plans: [] };

beforeEach(() => {
  locale = 'en';
  platformApi.mockReset();
  platformApi.mockImplementation(async (path: string) => {
    if (path.endsWith('/application-overrides/summary')) return { data: overrideSummary() };
    if (path.endsWith('/commercial-applications')) return { data: commercialApplications };
    if (path === '/platform/commercial-catalog') return { data: catalog };
    if (path.endsWith('/commercial-assignments')) return { data: [] };
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const t = (lang: 'en' | 'ar', namespace: string, key: string) => {
  const previous = locale; locale = lang; const text = translator(namespace)(key); locale = previous; return text;
};
const writes = () => platformApi.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');

describe('application override filter select has an accessible name (H15-08)', () => {
  for (const lang of ['en', 'ar'] as const) {
    it(`is named in ${lang === 'en' ? 'English' : 'Arabic'} by a real label, not by a placeholder`, async () => {
      locale = lang;
      render(<ApplicationOverrideCard tenantId="t1" />);
      const label = t(lang, 'platform.applicationOverrides', 'filterLabel');
      expect(label).not.toBe('filterLabel');
      const select = (await screen.findByLabelText(label)) as HTMLSelectElement;
      expect(select.tagName).toBe('SELECT');
      expect(screen.getByRole('combobox', { name: label })).toBe(select);
      const labelElement = document.querySelector(`label[for="${select.id}"]`);
      expect(select.id).not.toBe('');
      expect(labelElement?.textContent).toBe(label);
      // the label is for assistive technology; the sighted layout is unchanged
      expect(labelElement?.className).toContain('sr-only');
      // the accessible state is the current option
      expect(select.selectedOptions[0].textContent).toBe(t(lang, 'platform.applicationOverrides', 'filterAll'));
      // the search box keeps its own, different, name source
      expect(screen.getByPlaceholderText(t(lang, 'platform.applicationOverrides', 'search'))).not.toBe(select);
    });
  }

  it('still selects values and filters rows; no request body or endpoint changes', async () => {
    render(<ApplicationOverrideCard tenantId="t1" />);
    const select = (await screen.findByLabelText(en.platform.applicationOverrides.filterLabel)) as HTMLSelectElement;
    expect(select.value).toBe('all');
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(4)); // header + 3
    fireEvent.change(select, { target: { value: 'commercial' } });
    expect(select.value).toBe('commercial');
    expect(screen.getAllByRole('row').length).toBe(2); // header + the one commercially gated app
    fireEvent.change(select, { target: { value: 'built' } });
    expect(screen.getAllByRole('row').length).toBe(3); // built and not mandatory (coming_soon excluded)
    expect(platformApi.mock.calls).toEqual([['/platform/tenants/t1/application-overrides/summary']]);
    expect(writes()).toHaveLength(0);
  });

  it('keeps the same select options and values in Arabic', async () => {
    locale = 'ar';
    render(<ApplicationOverrideCard tenantId="t1" />);
    const select = (await screen.findByLabelText(ar.platform.applicationOverrides.filterLabel)) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['all', 'commercial', 'built']);
  });

  it('has the new key in both languages', () => {
    for (const lang of [ar, en]) expect(typeof (lang.platform.applicationOverrides as Record<string, unknown>).filterLabel).toBe('string');
  });
});

describe('commercial products scroll region is keyboard reachable only when it scrolls (H15-08)', () => {
  /** jsdom has no layout: make the (only) overflow-x-auto products wrapper report its measurements. */
  function measure(scrollWidth: number, clientWidth: number) {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.className.includes('overflow-x-auto') ? scrollWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.className.includes('overflow-x-auto') ? clientWidth : 0;
    });
  }
  const wrapper = () => document.querySelector('div.overflow-x-auto') as HTMLElement;
  const heading = (lang: 'en' | 'ar') => t(lang, 'platformTenants', 'applicationProducts');

  for (const lang of ['en', 'ar'] as const) {
    it(`when the table overflows it becomes a named focusable region (${lang})`, async () => {
      locale = lang;
      measure(896, 798);
      render(<CommercialOperationsCard tenantId="t1" />);
      await screen.findAllByText('Fuel Stations');
      const region = await screen.findByRole('region', { name: heading(lang) });
      expect(region).toBe(wrapper());
      expect(region.tabIndex).toBe(0);
      // named by the visible heading that already exists, not by duplicated text
      const headingEl = document.getElementById(region.getAttribute('aria-labelledby')!);
      expect(headingEl?.textContent).toBe(heading(lang));
      expect(headingEl?.tagName).toBe('H3');
      // clear focus indicator, scrolling behaviour untouched
      expect(region.className).toContain('focus-visible:ring-2');
      expect(region.className).toContain('overflow-x-auto');
      expect(region.className).toContain('lg:block');
      expect(region.className).toContain('hidden');
      expect(region.querySelector('table')?.className).toContain('min-w-[56rem]');
    });
  }

  it('is reached by Tab and shows nothing extra to tab through inside it', async () => {
    measure(896, 798);
    const user = userEvent.setup();
    render(<CommercialOperationsCard tenantId="t1" />);
    const region = await screen.findByRole('region', { name: heading('en') });
    expect(region.querySelectorAll('a[href],button,input,select,textarea,[tabindex]').length).toBe(0);
    const before = document.querySelector('button:not([disabled])') as HTMLElement;
    before.focus();
    const stops: Element[] = [];
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      stops.push(document.activeElement!);
      if (document.activeElement === region) break;
    }
    expect(stops.at(-1)).toBe(region);
    // exactly one tab stop was added for the scroll region
    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('adds no tab stop and no region when the table fits', async () => {
    measure(798, 798);
    render(<CommercialOperationsCard tenantId="t1" />);
    await screen.findAllByText('Fuel Stations');
    expect(wrapper().hasAttribute('tabindex')).toBe(false);
    expect(wrapper().hasAttribute('role')).toBe(false);
    expect(wrapper().hasAttribute('aria-labelledby')).toBe(false);
    expect(screen.queryByRole('region', { name: heading('en') })).toBeNull();
    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(0);
  });

  it('follows the layout: gains the stop when it starts to overflow and loses it when it fits again', async () => {
    let observe!: () => void;
    const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { constructor(cb: () => void) { observe = cb; } observe() {} disconnect() {} };
    try {
      let width = 798;
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.className.includes('overflow-x-auto') ? 896 : 0; });
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.className.includes('overflow-x-auto') ? width : 0; });
      render(<CommercialOperationsCard tenantId="t1" />);
      await screen.findByRole('region', { name: heading('en') });
      width = 1200;
      observe();
      await waitFor(() => expect(wrapper().hasAttribute('tabindex')).toBe(false));
      width = 700;
      observe();
      await waitFor(() => expect(wrapper().tabIndex).toBe(0));
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
  });

  it('keeps RTL: the page direction is not touched and the table still scrolls inside its wrapper', async () => {
    locale = 'ar';
    measure(896, 798);
    render(<div dir="rtl"><CommercialOperationsCard tenantId="t1" /></div>);
    const region = await screen.findByRole('region', { name: heading('ar') });
    expect(region.closest('[dir="rtl"]')).toBeTruthy();
    expect(region.hasAttribute('dir')).toBe(false);
    expect(within(region).getAllByRole('columnheader').length).toBe(5);
  });

  it('sends no new or changed request', async () => {
    measure(896, 798);
    render(<CommercialOperationsCard tenantId="t1" />);
    await screen.findByRole('region', { name: heading('en') });
    expect(writes()).toHaveLength(0);
    expect(platformApi.mock.calls.map(([path]) => path).sort()).toEqual([
      '/platform/commercial-catalog', '/platform/tenants/t1/commercial-applications', '/platform/tenants/t1/commercial-assignments',
    ]);
  });
});
