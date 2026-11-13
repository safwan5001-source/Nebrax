// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES } from '@/test-utils/intl';

const state = vi.hoisted(() => ({ permissions: ['*'] as string[], fail: 0, payload: {} as Record<string, unknown> }));
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string }>);
const ST1 = '00000000-0000-4000-8000-0000000000a1';

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ permissions: state.permissions }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string, opts: { method?: string } = {}) => {
    calls.push({ path, method: opts.method ?? 'GET' });
    if (path === '/fuel-stations/stations') return { data: [{ id: ST1, name: 'محطة أ', code: 'A', status: 'active' }] };
    if (path.startsWith('/fuel-stations/tanker-fills/inventory-review')) {
      if (state.fail) throw new (await import('@/lib/api')).ApiError(state.fail, 'x', {});
      return state.payload;
    }
    return { data: [] };
  }),
}));

import { InventoryReviewScreen } from './inventory-review-screen';

const T = (locale: 'ar' | 'en') => TEST_MESSAGES[locale].fuelTankers.inventory;
const row = (over: Record<string, unknown> = {}) => ({
  id: 'f1', number: 'FTF-2027-00001', voucher_number: '04052', fuel_station_id: ST1, quantity_milliliters: 2_000_000, quantity_liters: '2000.000', recorded_at: '2027-01-26T09:00:00+03:00',
  owner: { id: 'o', name: 'عسكر', code: 'ASK' }, tanker: { id: 't', plate_number: 'أ ب ج 1234' },
  inventory_readiness: { readiness: 'blocked', blockers: ['stock_record_missing', 'surprise_code'], review_reasons: ['overdue'], overdue: true, age_hours: 30, pool: { available_milliliters: 0, cumulative_milliliters: 2_000_000 } }, ...over,
});
const payload = (rows: unknown[] = [row()], meta: Record<string, unknown> = {}) => ({
  data: rows,
  meta: {
    page: 1, per_page: 25, total: rows.length, last_page: 1, truncated: false, posting_enabled: false, reconciliation_requirements: ['pool_quantity_equals_warehouse_stock', 'pool_value_equals_fuel_share_of_ledger_1140'],
    summary: { total: rows.length, ready: 0, needs_review: 0, blocked: rows.length, overdue: 1 },
    pools: [{ warehouse_id: 'w1', fuel_product_id: 'p1', stock_milliliters: 0, cost_pool_milliliters: 500, quantity_in_sync: false, pending_count: 1, pending_total_milliliters: 2_000_000, shortfall_milliliters: 2_000_000 }],
    ...meta,
  },
});

beforeEach(() => { calls.length = 0; state.permissions = ['*']; state.fail = 0; state.payload = payload(); });
afterEach(() => cleanup());

describe.each(['ar', 'en'] as const)('InventoryReviewScreen (%s)', (locale) => {
  const text = T(locale);
  const mount = () => renderIntl(<InventoryReviewScreen />, locale);

  it('renders the not-enabled notice, summary, rows with translated blockers (unknown codes get a generic label) and the pool reconciliation', async () => {
    mount();
    expect(await screen.findByText(text.notEnabled)).toBeTruthy();
    expect(document.querySelector('[data-posting-disabled="true"]')).not.toBeNull();
    const rowEl = await waitFor(() => { const el = document.querySelector('[data-fill-row]'); if (!el) throw new Error('row'); return el as HTMLElement; });
    expect(rowEl.getAttribute('data-readiness')).toBe('blocked');
    expect(within(rowEl).getByText(text.blocker.stock_record_missing)).toBeTruthy();
    expect(within(rowEl).getByText(text.blocker.unknown)).toBeTruthy();
    expect(within(rowEl).getByText(text.reason.overdue)).toBeTruthy();
    expect(rowEl.textContent).toContain('FTF-2027-00001');
    expect(rowEl.textContent).toContain('04052');
    expect(document.querySelector('[data-inventory-pools]')?.textContent).toContain(text.pools.outOfSync);
    expect(document.querySelector('[data-reconciliation]')?.textContent).toContain(text.requirements.ledgerNotChecked);
  });

  it('offers no posting, approval or deduction action — only read-only controls', async () => {
    mount();
    await screen.findByText(text.notEnabled);
    await waitFor(() => expect(document.querySelector('[data-fill-row]')).not.toBeNull());
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('sends the chosen filters to the server and resets to page one', async () => {
    mount();
    await waitFor(() => expect(document.querySelector('[data-fill-row]')).not.toBeNull());
    fireEvent.change(screen.getByLabelText(text.filters.readiness), { target: { value: 'blocked' } });
    await waitFor(() => expect(calls.some((c) => c.path.includes('readiness=blocked'))).toBe(true));
    fireEvent.change(screen.getByLabelText(text.filters.overdue), { target: { value: '1' } });
    await waitFor(() => expect(calls.some((c) => c.path.includes('readiness=blocked') && c.path.includes('overdue=1'))).toBe(true));
    await waitFor(() => expect(screen.getByLabelText(text.filters.station).querySelectorAll('option').length).toBe(2));
    fireEvent.change(screen.getByLabelText(text.filters.station), { target: { value: ST1 } });
    await waitFor(() => expect(calls.some((c) => c.path.includes(`station_id=${ST1}`))).toBe(true));
  });

  it('pages through results and shows the empty state', async () => {
    state.payload = payload([row()], { last_page: 2, page: 1, total: 30 });
    mount();
    await waitFor(() => expect(document.querySelector('[data-fill-row]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: text.next }));
    await waitFor(() => expect(calls.some((c) => c.path.includes('page=2'))).toBe(true));
    cleanup();
    state.payload = payload([]);
    mount();
    expect(await screen.findByText(text.empty)).toBeTruthy();
  });

  it('shows the closed-gate state on 404, forbidden on 403, and a retry on other errors', async () => {
    state.fail = 404;
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    expect(document.querySelector('[data-fill-row]')).toBeNull();
    cleanup();
    state.fail = 500;
    mount();
    expect(await screen.findByText(text.loadFailed)).toBeTruthy();
  });

  it('needs the dedicated review permission (and nothing is requested without it)', async () => {
    state.permissions = ['fuel_stations.view', 'fuel.tanker.fill.view'];
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    expect(calls).toHaveLength(0);
  });
});
