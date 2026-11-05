// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/shifts/s1', replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
}));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import type { CashSummary } from './cash-summary';
import { nozzle, product, pump, shiftDetail, station, tank } from './__fixtures__';
import { createBackend, type TenantData } from './__test-harness';
import type { ShiftDetail } from './schemas';
import { ShiftDetailScreen } from './shift-detail-screen';
import { StationOpsShell } from './shell';

const apiMock = vi.mocked(api);

function seedUser() {
  const user: AuthUser = { id: 'u1', name: 'Sami Operator', email: 'sami@example.test', role: 'cashier', tenant_id: 'T1', permissions: ['fuel_stations.view', 'fuel.shift.view', 'fuel.sale.view'], branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

const tenantData = (): TenantData => ({
  stations: [station('a', { name: 'Station A', timezone: 'Asia/Riyadh', branch_id: 'branch-A' })],
  products: [product('p1', 'Alpha')],
  pumps: [pump('pump1', 'a')],
  tanks: [tank('t1', 'a', 'p1')],
  nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1')],
  prices: [],
  shifts: [],
});

const summary = (over: Partial<CashSummary> = {}): CashSummary => ({
  state: 'live',
  basis: 'receiving_shift_receipts',
  components: {
    opening_float_minor: 20_000,
    official_cash_receipts: { available: true, amount_minor: 100_000, count: 2, reason: null },
    cash_in_minor: 0,
    cash_out_minor: 10_000,
    treasury_handover_minor: 10_000,
    expenses_minor: 0,
  },
  expected_cash_minor: 110_000,
  expected_cash_partial_minor: 110_000,
  expected_complete: true,
  incompleteness: [],
  counted_cash_minor: null,
  variance_minor: null,
  variance_final: false,
  network_receipts: { available: true, amount_minor: 40_000, reason: null, information_only: true },
  unattributed_cash_receipts: { count: 0, amount_minor: 0 },
  post_close_adjustments: { available: true, items: [], net_effect_minor: 0 },
  ...over,
});

function open(cash: CashSummary | undefined, over: Partial<ShiftDetail> = {}, locale: 'en' | 'ar' = 'en') {
  const data = tenantData();
  data.details = { s1: shiftDetail('s1', 'a', { number: 'SH-500', status: 'open', ...over, ...(cash ? { cash_summary: cash } : {}) }) };
  const backend = createBackend(data);
  apiMock.mockImplementation(async (path: string, options?: { headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
    return backend.handler(path, options?.headers as Record<string, string> | undefined) as never;
  });
  return renderIntl(<StationOpsShell><ShiftDetailScreen shiftId="s1" /></StationOpsShell>, locale);
}

const row = (key: string) => document.querySelector(`[data-cash-row="${key}"]`) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  apiMock.mockReset();
  seedUser();
});
afterEach(cleanup);

describe('cash summary on the shift screen', () => {
  it('shows each component, a complete expected total, and the network as information only', async () => {
    open(summary());
    await screen.findByText('SH-500');
    const section = screen.getByRole('region', { name: 'Cash summary' });
    expect(within(row('sales')).getByText(/1,?000\.00/)).toBeTruthy();
    expect(within(row('handover')).getByText(/100\.00/)).toBeTruthy();
    expect(within(row('expected')).getByText('Expected cash')).toBeTruthy();
    expect(within(row('network')).getByText(/400\.00/)).toBeTruthy();
    expect(within(section).getByText(/never part of the cash/)).toBeTruthy();
    expect(within(section).getByText(/update until the shift closes/)).toBeTruthy();
  });

  it('an incomplete expectation is labelled incomplete with its reasons and a counted shortfall is NOT called a shortage', async () => {
    open(summary({
      expected_complete: false, expected_cash_minor: null, expected_cash_partial_minor: 20_000,
      incompleteness: ['unattributed_cash_receipts'], unattributed_cash_receipts: { count: 2, amount_minor: 5_000 },
      counted_cash_minor: 15_000, variance_minor: -5_000, variance_final: false,
    }), { status: 'closed', closed_at: '2026-11-03T13:00:00+00:00' });
    await screen.findByText('SH-500');
    expect(within(row('expected')).getByText('Expected cash — incomplete')).toBeTruthy();
    expect(screen.getByText(/2 cash collections made before this was enabled/)).toBeTruthy();
    expect(within(row('variance')).getByText('Provisional difference')).toBeTruthy();
    expect(screen.queryByText('Shortage')).toBeNull();
    expect(screen.getByText(/Don't treat it as an overage or shortage/)).toBeTruthy();
  });

  it('a final variance is named with text: Shortage / Overage / Matches', async () => {
    open(summary({ state: 'frozen', counted_cash_minor: 109_000, variance_minor: -1_000, variance_final: true }), { status: 'closed', closed_at: '2026-11-03T13:00:00+00:00' });
    await screen.findByText('SH-500');
    expect(within(row('variance')).getByText('Shortage')).toBeTruthy();
    expect(screen.getByText(/Frozen when the shift closed/)).toBeTruthy();
  });

  it('components the viewer cannot see say so — no zero, no invented figure', async () => {
    open(summary({
      components: { ...summary().components, official_cash_receipts: { available: false, amount_minor: null, count: null, reason: 'permission' } },
      expected_complete: false, expected_cash_minor: null, expected_cash_partial_minor: 10_000, incompleteness: ['permission_sales_view'],
      network_receipts: { available: false, amount_minor: null, reason: 'permission', information_only: true },
    }));
    await screen.findByText('SH-500');
    expect(within(row('sales')).getByText('Not available for your role')).toBeTruthy();
    expect(within(row('network')).getByText('Not available for your role')).toBeTruthy();
    expect(within(row('sales')).queryByText(/0\.00/)).toBeNull();
  });

  it('warns about cash collections reversed after the shift closed, without touching the closed difference', async () => {
    open(summary({
      state: 'frozen', counted_cash_minor: 110_000, variance_minor: 0, variance_final: true,
      post_close_adjustments: { available: true, items: [{ payment_id: 'p1', amount_minor: 23_000, occurred_at: null }], net_effect_minor: -23_000 },
    }), { status: 'closed', closed_at: '2026-11-03T13:00:00+00:00' });
    await screen.findByText('SH-500');
    expect(screen.getByText(/1 cash collection\(s\) were reversed after this shift closed/)).toBeTruthy();
    expect(within(row('variance')).getByText('Matches')).toBeTruthy();
  });

  it('an older server without cash_summary keeps the previous cash section (collapsed) and shows no summary', async () => {
    open(undefined);
    await screen.findByText('SH-500');
    expect(screen.queryByRole('region', { name: 'Cash summary' })).toBeNull();
    expect(screen.getByText('Cash in this shift', { selector: 'summary' })).toBeTruthy();
  });

  it('only issues GET requests (the summary is read-only)', async () => {
    open(summary());
    await screen.findByText('SH-500');
    for (const call of apiMock.mock.calls) expect((call[1] as { method?: string } | undefined)?.method ?? 'GET').toBe('GET');
  });

  it.each(['en', 'ar'] as const)('has no axe violations and keeps digits 0-9 (%s)', async (locale) => {
    const { container } = open(summary({ counted_cash_minor: 110_000, variance_minor: 0, variance_final: true, state: 'frozen' }), { status: 'closed', closed_at: '2026-11-03T13:00:00+00:00' }, locale);
    await screen.findByText('SH-500');
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
    expect(row('expected').textContent).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('Arabic renders the same figures with Latin digits and Arabic labels', async () => {
    open(summary(), {}, 'ar');
    await screen.findByText('SH-500');
    expect(screen.getByRole('region', { name: 'ملخص النقد' })).toBeTruthy();
    expect(within(row('expected')).getByText('النقد المتوقع')).toBeTruthy();
    expect(row('sales').textContent).toMatch(/1,?000\.00/);
  });
});
