/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRiyal } from '@/lib/money';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import PlatformDashboardPage from './page';

const replace = vi.fn();
const platformApi = vi.fn();
let authenticated = true;
let locale: 'ar' | 'en' = 'en';

// الدالة مستقرة بين الرسوم كما في next-intl، وإلا أعاد useCallback([t]) التحميل بلا نهاية.
const translators: Record<'ar' | 'en', (key: string, values?: Record<string, string | number>) => string> = {
  ar: makeTranslator('ar'),
  en: makeTranslator('en'),
};
function makeTranslator(lang: 'ar' | 'en') {
  return (key: string, values?: Record<string, string | number>) => {
    const text = ((lang === 'ar' ? ar : en).platform as Record<string, unknown>)[key];
    if (typeof text !== 'string') throw new Error(`missing platform message: ${key}`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
}
vi.mock('next-intl', () => ({ useTranslations: () => translators[locale] }));
const router = { replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/platform-auth', () => ({
  isPlatformAuthenticated: () => authenticated,
  currentPlatformAdministrator: () => (authenticated ? { id: '1', name: 'Admin', email: 'a@b.c' } : null),
}));
vi.mock('@/lib/platform-api', () => ({ platformApi: (...args: unknown[]) => platformApi(...args) }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {} }));

const overview = {
  data: {
    tenants: { total: 12, active: 9, inactive: 3 },
    users: { total: 140, active: 120, inactive: 20 },
    subscriptions: {
      active: 8,
      trials: 4,
      renewals_next_7_days: 1,
      renewals_next_30_days: 3,
      renewals_next_60_days: 5,
      renewal_value_at_risk_minor: 1234500,
      renewal_value_at_risk: '12345.00',
      monthly_recurring_revenue_minor: 987650,
      monthly_recurring_revenue: '9876.50',
      annual_recurring_revenue_minor: 11851800,
      annual_recurring_revenue: '118518.00',
      average_active_subscription_minor: 123456,
      average_active_subscription: '1234.56',
      by_plan: [
        { plan: 'starter', active: 5, monthly_recurring_revenue_minor: 250000, monthly_recurring_revenue: '2500.00' },
        { plan: 'growth', active: 3, monthly_recurring_revenue_minor: 737650, monthly_recurring_revenue: '7376.50' },
      ],
    },
  },
};

beforeEach(() => {
  replace.mockClear();
  platformApi.mockReset();
  platformApi.mockResolvedValue(overview);
  authenticated = true;
  locale = 'en';
});
afterEach(cleanup);

async function renderLoaded() {
  const utils = render(<PlatformDashboardPage />);
  await screen.findByText(formatRiyal('9876.50'));
  return utils;
}

describe('platform dashboard (H1-3)', () => {
  it('does not duplicate the shell: no navigation links, no logout, no signed-in name', async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /sign out|تسجيل الخروج/i })).toBeNull();
    expect(screen.queryByText(/signed in as|مسجل الدخول/i)).toBeNull();
    expect(container.querySelector('nav')).toBeNull();
    // the only page action is refresh
    expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Refresh']);
  });

  it('keeps one h1 and labelled sections in a reading order: revenue, accounts, renewals, plans', async () => {
    const { container } = await renderLoaded();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const sections = Array.from(container.querySelectorAll('section[aria-labelledby]'));
    expect(sections.map((s) => document.getElementById(s.getAttribute('aria-labelledby') as string)?.textContent)).toEqual([
      'Contracted revenue',
      'Accounts',
      'Upcoming renewals',
      'Breakdown by plan',
    ]);
  });

  it('shows every existing API field with the same formatters and no new arithmetic', async () => {
    await renderLoaded();
    expect(screen.getByText(formatRiyal('9876.50'))).toBeTruthy();
    expect(screen.getByText(formatRiyal('118518.00'))).toBeTruthy();
    expect(screen.getByText(formatRiyal('12345.00'))).toBeTruthy();

    const tenants = screen.getByText('Tenants').closest('[data-awj-card]') as HTMLElement;
    expect(within(tenants).getByText('12')).toBeTruthy();
    expect(within(tenants).getByText('9')).toBeTruthy();
    expect(within(tenants).getByText('3')).toBeTruthy();
    const users = screen.getByText('Users').closest('[data-awj-card]') as HTMLElement;
    expect(within(users).getByText('140')).toBeTruthy();
    expect(within(users).getByText('120')).toBeTruthy();
    expect(within(users).getByText('20')).toBeTruthy();
    const subscriptions = screen.getByText('Subscriptions').closest('[data-awj-card]') as HTMLElement;
    expect(within(subscriptions).getByText('8')).toBeTruthy();
    expect(within(subscriptions).getByText('4')).toBeTruthy();

    for (const [label, value] of [['Renewals in 7 days', '1'], ['Renewals in 30 days', '3'], ['Renewals in 60 days', '5']]) {
      expect(screen.getByText(label as string).nextElementSibling?.textContent).toBe(value);
    }

    const rows = screen.getAllByRole('row').map((row) => row.textContent);
    expect(rows.some((text) => text?.includes('starter') && text.includes(formatRiyal('2500.00')) && text.includes('5'))).toBe(true);
    expect(rows.some((text) => text?.includes('growth') && text.includes(formatRiyal('7376.50')) && text.includes('3'))).toBe(true);
    // no figure is derived: the sum of plan MRR and the unused average never appear
    expect(screen.queryByText(formatRiyal('1234.56'))).toBeNull();
  });

  it('separates contracted revenue from invoiced and collected without inventing figures', async () => {
    await renderLoaded();
    expect(screen.getByText(en.platform.contractedRevenueNotice)).toBeTruthy();
    const scope = screen.getByText(en.platform.revenueScopeTitle).closest('div') as HTMLElement;
    const terms = within(scope).getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['Contracted revenue', 'Invoiced revenue', 'Collected amounts']);
    expect(within(scope).getAllByText('Not available')).toHaveLength(2);
    expect(within(scope).getAllByText('Shown')).toHaveLength(1);
    // the scope block itself carries no money values
    expect(scope.textContent).not.toMatch(/\d/);
  });

  it('shows a layout-shaped skeleton first, then keeps the last good figures while refreshing', async () => {
    let resolveSecond: (value: unknown) => void = () => {};
    const { container } = render(<PlatformDashboardPage />);
    expect(await screen.findByTestId('overview-skeleton')).toBeTruthy();
    await screen.findByText(formatRiyal('9876.50'));

    platformApi.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(formatRiyal('9876.50'))).toBeTruthy();
    expect(container.querySelector('[data-testid="overview-skeleton"]')).toBeNull();
    expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('true');

    resolveSecond(overview);
    await waitFor(() => expect(container.querySelector('main')?.getAttribute('aria-busy')).toBe('false'));
  });

  it('announces a load failure as an alert with a retry that reloads', async () => {
    platformApi.mockRejectedValueOnce(new Error('boom'));
    render(<PlatformDashboardPage />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(en.platform.loadFailed);
    fireEvent.click(screen.getByRole('button', { name: en.platform.retry }));
    await screen.findByText(formatRiyal('9876.50'));
    expect(platformApi).toHaveBeenCalledTimes(2);
    expect(platformApi).toHaveBeenCalledWith('/platform/overview');
  });

  it('shows the empty plan sentence when no plan has subscriptions', async () => {
    platformApi.mockResolvedValueOnce({ data: { ...overview.data, subscriptions: { ...overview.data.subscriptions, by_plan: [] } } });
    render(<PlatformDashboardPage />);
    await screen.findByText(en.platform.noSubscriptions);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps the session guard: without a platform session it redirects and requests nothing', async () => {
    authenticated = false;
    render(<PlatformDashboardPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/platform/login'));
    expect(platformApi).not.toHaveBeenCalled();
  });

  it('renders in Arabic with the same structure', async () => {
    locale = 'ar';
    const { container } = render(<PlatformDashboardPage />);
    await screen.findByText(formatRiyal('9876.50'));
    expect(screen.getByText(ar.platform.revenueScopeTitle)).toBeTruthy();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelectorAll('section[aria-labelledby]')).toHaveLength(4);
  });

  it('has every new message key in both locales', () => {
    const keys = ['accountsTitle', 'revenueTitle', 'revenueScopeTitle', 'scopeContracted', 'scopeContractedDesc', 'scopeInvoiced', 'scopeInvoicedDesc', 'scopeCollected', 'scopeCollectedDesc', 'scopeShown', 'scopeNotReported', 'renewalsTitle', 'renewalsNote'];
    for (const locale of [ar, en]) for (const key of keys) expect(typeof (locale.platform as Record<string, unknown>)[key]).toBe('string');
  });
});
