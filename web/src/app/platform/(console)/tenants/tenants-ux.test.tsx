/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import PlatformTenantsPage from './page';

const { platformApi, replace, downloadCsv, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {}
  return { platformApi: vi.fn(), replace: vi.fn(), downloadCsv: vi.fn(), ApiError };
});
let locale: 'en' | 'ar' = 'en';

type Bag = Record<string, unknown>;
function makeTranslator(ns: 'platformTenants' | 'common' | 'nebrax', lang: 'en' | 'ar') {
  const root = (lang === 'ar' ? ar : en) as unknown as Record<string, Bag>;
  const fn = (key: string, values?: Record<string, string | number>) => {
    const text = root[ns]?.[key];
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
  return Object.assign(fn, { rich: (key: string, values?: Record<string, unknown>) => fn(key, values as Record<string, string | number>) });
}
const translators = {
  en: { platformTenants: makeTranslator('platformTenants', 'en'), common: makeTranslator('common', 'en'), nebrax: makeTranslator('nebrax', 'en') },
  ar: { platformTenants: makeTranslator('platformTenants', 'ar'), common: makeTranslator('common', 'ar'), nebrax: makeTranslator('nebrax', 'ar') },
};
vi.mock('next-intl', () => ({
  useTranslations: (ns: 'platformTenants' | 'common' | 'nebrax') => translators[locale][ns] ?? translators[locale].common,
  useLocale: () => locale,
}));
const router = { replace, push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/platform-auth', () => ({ isPlatformAuthenticated: () => true }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError }));
vi.mock('@/lib/export', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/export')>()), downloadCsv }));
vi.mock('@/components/platform/global-application-controls-card', () => ({
  GlobalApplicationControlsCard: () => <div data-testid="global-application-controls" />,
}));

function tenant(id: string, name: string, plan: string, active: boolean, extra: Bag = {}) {
  return {
    id, name, slug: `${id}-slug`, account_number: 1000001, support_number: 2000002, plan, is_active: active,
    trial_ends_at: '2026-12-31', users_count: 7,
    contact: { name: 'Owner One', email: 'owner@example.com', phone: '+966500000000' }, ...extra,
  };
}
const rows = [tenant('t1', 'Free Co', 'free', true), tenant('t2', 'Pro Co', 'pro', false, { trial_ends_at: null, contact: null })];
const payload = (data = rows, total = 62) => ({ data, pagination: { current_page: 1, last_page: 3, per_page: 25, total } });

beforeEach(() => {
  locale = 'en';
  platformApi.mockReset();
  platformApi.mockResolvedValue(payload());
  downloadCsv.mockReset();
  replace.mockReset();
});
afterEach(cleanup);

const t = () => (en as unknown as Record<string, Bag>).platformTenants as Record<string, string>;

describe('platform tenants list UX (H1-4A)', () => {
  it('has no private back/navigation links in the header; Refresh has a visible label and 44px height', async () => {
    const { container } = render(<PlatformTenantsPage />);
    await screen.findAllByText('Free Co');
    const header = container.querySelector('header') as HTMLElement;
    expect(header.querySelectorAll('a')).toHaveLength(0);
    const refresh = within(header).getByRole('button', { name: 'Refresh' });
    expect(refresh.textContent).toContain('Refresh');
    expect(refresh.className).toContain('h-11');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('section[aria-labelledby="platform-tenant-list"] h2')?.textContent).toBe('Tenant list');
  });

  it('states what the counts and the CSV cover and does not present local figures as global', async () => {
    render(<PlatformTenantsPage />);
    await screen.findAllByText('Free Co');
    expect(screen.getByText(t().pageFilterNote)).toBeTruthy();
    expect(screen.getByText(t().csvNote)).toBeTruthy();
    expect(screen.getByText('Showing 2 of 2 rows loaded on this page. Total across all pages: 62.')).toBeTruthy();
    expect(screen.queryByText(t().localFilterWarning)).toBeNull();
    expect(screen.getByRole('button', { name: t().exportLabel })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: t().search })).toBeTruthy();
  });

  it('local filters change only the shown count, warn, and never reach the server', async () => {
    render(<PlatformTenantsPage />);
    await screen.findAllByText('Free Co');
    const calls = platformApi.mock.calls.length;
    fireEvent.change(screen.getByRole('combobox', { name: t().filterByPlan }), { target: { value: 'pro' } });
    expect(screen.getByText('Showing 1 of 2 rows loaded on this page. Total across all pages: 62.')).toBeTruthy();
    expect(screen.getByText(t().localFilterWarning)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(platformApi.mock.calls.length).toBe(calls);
  });

  it('CSV exports only the filtered rows of the loaded page', async () => {
    render(<PlatformTenantsPage />);
    await screen.findAllByText('Free Co');
    fireEvent.change(screen.getByRole('combobox', { name: t().filterByStatus }), { target: { value: 'true' } });
    fireEvent.click(screen.getByRole('button', { name: t().exportLabel }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [name, csv] = downloadCsv.mock.calls[0] as [string, string];
    expect(name).toBe('tenants');
    expect(csv).toContain('Free Co');
    expect(csv).not.toContain('Pro Co');
    expect(csv.trim().split('\n')).toHaveLength(2);
  });

  it('keeps the CSV column order exactly as before the table reorder (headers and values)', async () => {
    render(<PlatformTenantsPage />);
    await screen.findAllByText('Free Co');
    fireEvent.click(screen.getByRole('button', { name: t().exportLabel }));
    const [, csv] = downloadCsv.mock.calls[0] as [string, string];
    const [header, first, second] = csv.replace(/^\ufeff/, '').trim().split(/\r?\n/);
    // headers: the column order shipped by H1-PAGINATION
    expect(header).toBe(
      ['name', 'accountNumber', 'supportNumber', 'contactName', 'contact', 'phone', 'plan', 'status', 'trialEndsAt', 'usersCount']
        .map((key) => t()[key])
        .join(',')
    );
    // values follow the same order
    expect(first).toBe('Free Co,1000001,2000002,Owner One,owner@example.com,+966500000000,free,true,2026-12-31,7');
    expect(second).toBe('Pro Co,1000001,2000002,,,,pro,false,,7');
    // while the on-screen table puts plan and status right after the organisation
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
    expect(headers.slice(0, 3)).toEqual(['Organization', 'Plan', 'Status']);
  });

  it('distinguishes the three empty cases and offers Clear filters when a filter hides the page', async () => {
    const { rerender } = render(<PlatformTenantsPage />);
    await screen.findAllByText('Free Co');
    fireEvent.change(screen.getByRole('combobox', { name: t().filterByPlan }), { target: { value: 'basic' } });
    expect(screen.getByText(t().emptyFiltered)).toBeTruthy();
    expect(screen.getByText(t().emptyFilteredHint)).toBeTruthy();
    const clear = screen.getAllByRole('button', { name: t().clearFilters });
    expect(clear.length).toBeGreaterThan(0);
    fireEvent.click(clear[0] as HTMLElement);
    expect(screen.getAllByText('Free Co').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: t().clearFilters })).toBeNull();
    rerender(<PlatformTenantsPage />);

    cleanup();
    platformApi.mockResolvedValue(payload([], 0));
    render(<PlatformTenantsPage />);
    expect(await screen.findByText(t().empty)).toBeTruthy();
  });

  it('keeps the global controls visible when the list fails, and Retry reloads the same page', async () => {
    platformApi.mockRejectedValueOnce(new ApiError('blocked'));
    render(<PlatformTenantsPage />);
    expect((await screen.findByRole('alert')).textContent).toBe('blocked');
    expect(screen.getByTestId('global-application-controls')).toBeTruthy();
    const retry = screen.getByRole('button', { name: t().retry });
    expect(retry.className).toContain('h-11');
    fireEvent.click(retry);
    await screen.findAllByText('Free Co');
    expect(platformApi).toHaveBeenLastCalledWith('/platform/tenants?per_page=25&page=1');
  });

  it('mobile cards keep every field the table has, name first, with LTR values and a 44px name link', async () => {
    const { container } = render(<PlatformTenantsPage />);
    await screen.findAllByText('Free Co');
    const items = Array.from(container.querySelectorAll('ul > li'));
    expect(items).toHaveLength(2);
    const card = items[0] as HTMLElement;
    const link = within(card).getByRole('link', { name: 'Free Co' });
    expect(link.getAttribute('href')).toBe('/platform/tenants/t1');
    expect(link.className).toContain('min-h-11');
    // order: name before account number before status/plan before the contact block
    const text = card.textContent ?? '';
    for (const [a, b] of [['Free Co', 'Account number'], ['Account number', 'Active'], ['Active', 'Owner name']] as const) {
      expect(text.indexOf(a)).toBeGreaterThan(-1);
      expect(text.indexOf(a)).toBeLessThan(text.indexOf(b));
    }
    for (const value of ['1000001', '2000002', 'free', 'Active', '7', '2026-12-31', 'Owner One', 'owner@example.com', '+966500000000', 't1-slug']) {
      expect(text).toContain(value);
    }
    expect(card.querySelector('dd[dir="ltr"]')).toBeTruthy();
    // a tenant without contact or trial still renders placeholders, not blanks
    const bare = (items[1] as HTMLElement).textContent ?? '';
    expect(bare).toContain('No trial');
    expect(bare).toContain('—');
  });

  it('renders in Arabic with the same structure', async () => {
    locale = 'ar';
    const { container } = render(<PlatformTenantsPage />);
    await screen.findAllByText('Free Co');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByText((ar as unknown as Record<string, Record<string, string>>).platformTenants.csvNote as string)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2));
  });

  it('has every new message key in both locales', () => {
    const keys = ['listTitle', 'filtersLabel', 'clearFilters', 'csvNote', 'exportLabel', 'localFilterWarning', 'listSummary', 'emptyFiltered', 'emptyFilteredHint', 'emptySearch'];
    for (const locale of [ar, en]) for (const key of keys) {
      expect(typeof (locale as unknown as Record<string, Record<string, unknown>>).platformTenants[key]).toBe('string');
    }
  });
});
