// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/products', replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
}));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import { nozzle, product, pump, station, tank } from './__fixtures__';
import { createBackend, type Backend, type TenantData } from './__test-harness';
import { ProductsScreen } from './products-screen';
import { StationOpsShell } from './shell';

const apiMock = vi.mocked(api);
const CAP = 34_000_000; // 34,000 L
const book = (ml: number, over: Record<string, unknown> = {}) => ({ book_level: { milliliters: ml, basis: 'warehouse_book', as_of: null, ...over }, book_level_unavailable_reason: null });
const unavailable = (reason: string) => ({ book_level: null, book_level_unavailable_reason: reason });

let backend: Backend;

function seedUser(permissions = ['fuel_stations.view']) {
  const user: AuthUser = { id: 'u1', name: 'Sami', email: 's@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

/** كل بطاقة بحالة مختلفة من عقد الخادم؛ t-other في محطة أخرى برصيد مرتفع لا يجوز أن يظهر. */
function tenantData(): TenantData {
  const t = (id: string, over: Record<string, unknown> = {}) => tank(id, 'a', 'p1', { capacity_milliliters: CAP, ...over } as never);
  return {
    stations: [station('a', { name: 'Station A' }), station('b', { name: 'Station B' })],
    products: [product('p1', 'Alpha')],
    pumps: [pump('pump1', 'a')],
    tanks: [
      t('t1', book(18_700_000)),                       // 55% good
      t('t2', book(11_900_000)),                       // 35% monitor
      t('t3', book(4_760_000)),                        // 14% low
      t('t4', book(0)),                                // real zero
      t('t5', book(36_000_000)),                       // over capacity
      t('t6', unavailable('multi_tank')),
      t('t7', {}),                                     // older server: no fields at all
      t('t8', { book_level: { milliliters: '18700000', basis: 'warehouse_book', as_of: null }, book_level_unavailable_reason: null }), // corrupt
      t('t9', { ...book(4_000_000), minimum_level_milliliters: 5_000_000 }),
      t('t10', unavailable('no_stock_record')),
      tank('t-other', 'b', 'p1', { capacity_milliliters: CAP, ...book(30_000_000) } as never),
    ],
    nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1')],
    prices: [],
    shifts: [],
  };
}

function connect(data: TenantData) {
  backend = createBackend(data);
  apiMock.mockImplementation(async (path: string, options?: { headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
    return backend.handler(path, options?.headers as Record<string, string> | undefined) as never;
  });
  return backend;
}

beforeEach(() => {
  localStorage.clear();
  apiMock.mockReset();
});
afterEach(cleanup);

const renderProducts = (locale: 'en' | 'ar') => renderIntl(<StationOpsShell><ProductsScreen /></StationOpsShell>, locale);
const card = async (name: string) => {
  const heading = await screen.findByText(new RegExp(`^Tank ${name}\\b`));
  return heading.closest('li') as HTMLElement;
};

describe('TANK-LEVEL-P2 — tank cards show the server book balance', () => {
  it('shows the book balance with litres, percent and status inside each card (English)', async () => {
    seedUser();
    connect(tenantData());
    const { container } = renderProducts('en');

    const good = within(await card('t1'));
    expect(good.getByText('Book balance')).toBeTruthy();
    expect(good.getByText('55% — Good')).toBeTruthy();
    expect(good.getByText('18,700 of 34,000 L')).toBeTruthy();
    expect(good.getByRole('meter').getAttribute('aria-valuenow')).toBe('55');

    expect(within(await card('t2')).getByText('35% — Monitor')).toBeTruthy();
    expect(within(await card('t3')).getByText('14% — Low')).toBeTruthy();
    // the capacity row of the card is unchanged next to the new indicator
    expect(within(await card('t1')).getByText('Capacity')).toBeTruthy();

    expect(container.querySelectorAll('[data-tank-level="ok"]').length).toBe(5); // t1 t2 t3 t4 t9
  });

  it('shows the same in Arabic with Latin digits', async () => {
    seedUser();
    connect(tenantData());
    renderProducts('ar');
    const good = within(await card('t1'));
    expect(good.getByText('الرصيد الدفتري')).toBeTruthy();
    expect(good.getByText('55% — جيد')).toBeTruthy();
    expect(good.getByText('18,700 من 34,000 لتر')).toBeTruthy();
  });

  it('a real zero balance is 0% (low) — not unavailable', async () => {
    seedUser();
    connect(tenantData());
    renderProducts('en');
    const zero = within(await card('t4'));
    expect(zero.getByText('0% — Low')).toBeTruthy();
    expect(zero.getByText('0 of 34,000 L')).toBeTruthy();
    expect(zero.queryByText('Level unavailable')).toBeNull();
  });

  it('over capacity is shown as an anomaly with both numbers, never hidden or clamped', async () => {
    seedUser();
    connect(tenantData());
    renderProducts('en');
    const over = within(await card('t5'));
    expect(over.getByText('Level exceeds capacity')).toBeTruthy();
    expect(over.getByText('36,000 of 34,000 L')).toBeTruthy();
    expect(over.queryByRole('meter')).toBeNull();
    expect(over.queryByText(/100%/)).toBeNull();
  });

  it('multi_tank explains the balance is not available per tank — no bar, no number', async () => {
    seedUser();
    connect(tenantData());
    renderProducts('en');
    const multi = within(await card('t6'));
    expect(multi.getByText('Level unavailable')).toBeTruthy();
    expect(multi.getByText("Balance isn't available per tank: more than one tank feeds the same stock.")).toBeTruthy();
    expect(multi.queryByRole('meter')).toBeNull();
    expect(within(await card('t10')).getByText('There is no stock record for this product in the warehouse yet.')).toBeTruthy();
  });

  it('an older server without the fields, and a corrupt payload, each get an explicit state for that card only', async () => {
    seedUser();
    connect(tenantData());
    renderProducts('en');
    expect(within(await card('t7')).getByText("The server didn't send balance data.")).toBeTruthy();
    expect(within(await card('t8')).getByText("The balance data received isn't valid.")).toBeTruthy();
    // one corrupt card does not take the page or its neighbours down
    expect(within(await card('t1')).getByText('55% — Good')).toBeTruthy();
  });

  it('shows the minimum-level alert only for the tank whose balance is below its configured minimum', async () => {
    seedUser();
    connect(tenantData());
    const { container } = renderProducts('en');
    const low = await card('t9');
    expect(within(low).getByText("Alert: the balance is below the tank's configured minimum level (5,000 L).")).toBeTruthy();
    expect(container.querySelectorAll('[data-minimum-alert]').length).toBe(1);
  });

  it('never shows an update time, and the note says it is a book balance, not a measurement', async () => {
    seedUser();
    connect(tenantData());
    const { container } = renderProducts('en');
    await card('t1');
    expect(container.textContent).not.toMatch(/Last updated|آخر تحديث/);
    expect(screen.getByText(/book balance computed from approved movements, not a physical measurement/)).toBeTruthy();
    expect(screen.queryByText(/aren't shown here yet/)).toBeNull();
  });

  it('only shows tanks of the selected station and uses no data beyond the existing authorized GETs', async () => {
    seedUser();
    connect(tenantData());
    const { container } = renderProducts('en');
    await card('t1');
    expect(screen.queryByText(/Tank t-other/)).toBeNull();
    expect(container.textContent).not.toContain('30,000');
    // the screen's own requests are the same read-only calls as before: no new endpoint, no body, no write
    const paths = apiMock.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith('/fuel-stations/'));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => /^\/fuel-stations\/(stations|products|pumps|nozzles|tanks|prices)(\?|$|\/effective)/.test(path))).toBe(true);
    const nonGet = apiMock.mock.calls.filter(([path, options]) => {
      const o = options as { method?: string; body?: unknown } | undefined;
      return String(path) !== '/me' && (o?.method !== 'GET' || o?.body !== undefined);
    });
    expect(nonGet).toEqual([]);
    expect(backend.callsTo('/fuel-stations/tanks')).toHaveLength(1);
  });

  it('a forbidden tanks endpoint shows the permission state and never any level', async () => {
    seedUser();
    connect(tenantData());
    backend.fail((url) => url.includes('/fuel-stations/tanks'), new ApiError(403, 'forbidden', {}));
    const { container } = renderProducts('en');
    await waitFor(() => expect(screen.queryByText('Book balance')).toBeNull());
    await screen.findByRole('alert');
    expect(container.querySelector('[data-tank-level]')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('an empty tank list keeps the explicit empty state', async () => {
    seedUser();
    connect({ ...tenantData(), tanks: [] });
    renderProducts('en');
    expect(await screen.findByText('No tanks')).toBeTruthy();
  });

  it.each(['ar', 'en'] as const)('has no accessibility violations (%s)', async (locale) => {
    seedUser();
    connect(tenantData());
    const { container } = renderProducts(locale);
    await card('t1');
    expect((await axe(container)).violations).toEqual([]);
  });
});
