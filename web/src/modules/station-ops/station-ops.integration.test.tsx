// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops', replace: vi.fn(), refresh: vi.fn() }));
const company = vi.hoisted(() => ({ value: { name: 'Acme Fuel Co', logo: null as string | null } }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
}));
vi.mock('@/lib/company', () => ({ useCompany: () => company.value }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import { AUTH_SESSION_CHANGED_EVENT, type AuthUser } from '@/lib/auth';
import { BRANCH_CHANGED_EVENT, setActiveBranchId } from '@/lib/branch';
import { effectivePrice, meter, shift as makeShift, shiftDetail, nozzle, product, pump, station, tank, tankReading, unpriced } from './__fixtures__';
import { createBackend, type Backend, type TenantData } from './__test-harness';
import { HomeScreen } from './home-screen';
import { ProductsScreen } from './products-screen';
import { ProfileScreen } from './profile-screen';
import { SettingsScreen } from './settings-screen';
import { StationOpsShell } from './shell';
import { ShiftsScreen } from './shifts-screen';
import { stationPreferenceKey } from './context';

const apiMock = vi.mocked(api);

const VIEW = ['fuel_stations.view', 'fuel.shift.view', 'fuel.sale.view'];

function seedUser(over: Partial<AuthUser> = {}): AuthUser {
  const user: AuthUser = { id: 'u1', name: 'Sami Operator', email: 'sami@example.test', role: 'cashier', tenant_id: 'T1', permissions: VIEW, branch_ids: [], warehouse_ids: [], ...over };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
  return user;
}

/** مستأجر بمحطتين مختلفتين الأصناف (لا قائمة وقود ثابتة): A = Alpha/Beta (+Gamma غير مربوط)، B = Delta فقط. */
function tenantData(prefix = ''): TenantData {
  const p = (id: string) => `${prefix}${id}`;
  return {
    stations: [station(p('a'), { name: `${prefix}Station A` }), station(p('b'), { name: `${prefix}Station B` })],
    products: [product(p('p1'), `${prefix}Alpha`), product(p('p2'), `${prefix}Beta`), product(p('p3'), `${prefix}Gamma`), product(p('p4'), `${prefix}Delta`)],
    pumps: [pump(p('pump1'), p('a')), pump(p('pump2'), p('a')), pump(p('pump3'), p('b'))],
    tanks: [tank(p('t1'), p('a'), p('p1')), tank(p('t2'), p('a'), p('p2')), tank(p('t3'), p('b'), p('p4'))],
    nozzles: [
      nozzle(p('n1'), p('a'), p('pump1'), p('t1'), p('p1')),
      nozzle(p('n2'), p('a'), p('pump2'), p('t2'), p('p2')),
      nozzle(p('n3'), p('b'), p('pump3'), p('t3'), p('p4')),
    ],
    prices: [
      effectivePrice(p('a'), p('p1'), 950),
      unpriced(p('a'), p('p2')),
      effectivePrice(p('b'), p('p4'), 1200, { source: 'tenant_default' }),
    ],
    shifts: [],
  };
}

let backend: Backend;

function connect(data: TenantData, options?: { pageSize?: number }) {
  backend = createBackend(data, options);
  apiMock.mockImplementation(async (path: string, options?: { headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
    return backend.handler(path, options?.headers as Record<string, string> | undefined) as never;
  });
  return backend;
}

beforeEach(() => {
  localStorage.clear();
  nav.pathname = '/fuel-stations/ops';
  nav.replace.mockReset();
  nav.refresh.mockReset();
  company.value = { name: 'Acme Fuel Co', logo: null };
  apiMock.mockReset();
});
afterEach(cleanup);

const renderOps = (ui: React.ReactElement, locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell>{ui}</StationOpsShell>, locale);
const stationSelect = () => screen.findByRole('combobox', { name: /station|المحطة/i });

describe('stations are the authorized ones only', () => {
  it('offers exactly the stations AWJ returned and never invents one', async () => {
    seedUser();
    connect(tenantData());
    renderOps(<HomeScreen />);
    const select = await stationSelect();
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Station A', 'Station B']);
  });

  it('ignores a remembered station that is no longer authorized', async () => {
    seedUser();
    localStorage.setItem(stationPreferenceKey('T1', 'u1'), 'revoked-station');
    connect(tenantData());
    renderOps(<HomeScreen />);
    expect(((await stationSelect()) as HTMLSelectElement).value).toBe('a');
  });

  it('shows the honest empty state when no station is assigned', async () => {
    seedUser();
    connect({ ...tenantData(), stations: [] });
    renderOps(<HomeScreen />);
    expect(await screen.findByText('No stations assigned to you')).toBeTruthy();
    expect(backend.callsTo('/products')).toHaveLength(0);
  });
});

describe('products, prices and dispensability', () => {
  it('lists only products with a real active nozzle; unmapped products are a configuration note, not a product', async () => {
    seedUser();
    connect(tenantData());
    renderOps(<HomeScreen />);

    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.queryByText('Gamma')).toBeNull(); // سجل بلا فوهة
    expect(screen.queryByText('Delta')).toBeNull(); // فوهته في محطة أخرى
    expect(screen.getByText(/not linked to an active nozzle at this station: 2/)).toBeTruthy();
  });

  it('shows the station price, and "not set" — never zero — when there is none', async () => {
    seedUser();
    connect(tenantData());
    const { container } = renderOps(<HomeScreen />);
    await screen.findByText('Alpha');
    expect(await screen.findByText(/9\.50/)).toBeTruthy();
    expect(screen.getByText('Price not set')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\b0\.00\b/);
  });

  it('uses the organization default price when the station has no override, and labels it', async () => {
    seedUser();
    const data = tenantData();
    data.prices = [effectivePrice('a', 'p1', 1150, { source: 'tenant_default' }), unpriced('a', 'p2')];
    connect(data);
    renderOps(<HomeScreen />);
    expect(await screen.findByText(/11\.50/)).toBeTruthy();
    expect(screen.getAllByText('Organization default price').length).toBeGreaterThan(0);
  });

  it('shows the source, the validity date and the VAT mode next to the server-resolved price', async () => {
    seedUser();
    const data = tenantData();
    data.prices = [effectivePrice('a', 'p1', 1150, { source: 'station_override', tax_mode: 'tax_exclusive', effective_from: '2026-03-04T08:00:00+00:00' }), unpriced('a', 'p2')];
    connect(data);
    renderOps(<HomeScreen />);
    expect(await screen.findByText(/11\.50/)).toBeTruthy();
    expect(screen.getByText('Station price')).toBeTruthy();
    expect(screen.getByText('Before VAT')).toBeTruthy();
    expect(screen.getByText(/Effective since/)).toBeTruthy();
  });

  it('shows the price but flags a sale blocker when the VAT mode is unset (never hides it, never guesses)', async () => {
    seedUser();
    const data = tenantData();
    data.prices = [effectivePrice('a', 'p1', 950, { tax_mode: null, sellable: false, blockers: ['tax_mode_unset'] }), unpriced('a', 'p2')];
    connect(data);
    renderOps(<HomeScreen />);
    expect(await screen.findByText(/9\.50/)).toBeTruthy();
    expect(screen.getByText('VAT mode not set')).toBeTruthy();
    expect(screen.getByText('Official sale not ready: VAT mode is not set')).toBeTruthy();
  });

  it('never presents a non-liter or unknown server row as a price', async () => {
    seedUser();
    const data = tenantData();
    data.prices = [effectivePrice('a', 'p1', 950, { unit: 'pcs' }), unpriced('a', 'p2')];
    connect(data);
    const { container } = renderOps(<HomeScreen />);
    await screen.findByText('Alpha');
    await waitFor(() => expect(screen.getByText("Couldn't load price")).toBeTruthy());
    expect(container.textContent).not.toMatch(/9\.50/);
  });

  it('asks the server for the effective price once per station and never reads the price history', async () => {
    seedUser();
    connect(tenantData());
    renderOps(<HomeScreen />);
    await screen.findByText(/9\.50/);
    const priceCalls = backend.callsTo('/prices');
    expect(priceCalls).toHaveLength(1);
    expect(priceCalls[0]).toMatch(/^\/fuel-stations\/prices\/effective\?station_id=a$/);
  });

  it('keeps the products visible when the prices endpoint answers 403 and says "not available"', async () => {
    seedUser();
    connect(tenantData());
    backend.fail((url) => url.includes('/prices'), new ApiError(403, 'forbidden', {}));
    renderOps(<HomeScreen />);
    expect(await screen.findByText('Alpha')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Not available for your permissions').length).toBe(2));
  });

  it('never asks for prices without fuel.sale.view', async () => {
    seedUser({ permissions: ['fuel_stations.view', 'fuel.shift.view'] });
    connect(tenantData());
    renderOps(<HomeScreen />);
    await screen.findByText('Alpha');
    expect(screen.getAllByText('Not available for your permissions')).toHaveLength(2);
    expect(backend.callsTo('/prices')).toHaveLength(0);
  });

  it('drills down to pumps, nozzles and tanks with capacity in liters', async () => {
    seedUser();
    connect(tenantData());
    renderOps(<ProductsScreen />);
    expect(await screen.findByRole('heading', { name: 'Pumps & nozzles' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Tanks' })).toBeTruthy();
    expect(screen.getAllByText('20,000').length).toBe(2);
    expect(screen.getAllByText('20,000')[0].nextElementSibling?.textContent).toBe('L');
    expect(screen.queryByText(/Tank t3/)).toBeNull(); // خزان محطة أخرى
  });

  it('flags a nozzle that cannot dispense instead of presenting it as available', async () => {
    seedUser();
    const data = tenantData();
    data.nozzles[1] = { ...data.nozzles[1], status: 'maintenance' };
    connect(data);
    renderOps(<ProductsScreen />);
    expect(await screen.findByText('Nozzle is inactive')).toBeTruthy();
    expect(screen.getByText(/not linked to an active nozzle at this station: 3/)).toBeTruthy();
  });
});

describe('switching stations', () => {
  it('clears the previous station immediately and shows only the new scope', async () => {
    seedUser();
    const server = connect(tenantData());
    renderOps(<HomeScreen />);
    await screen.findByText('Alpha');

    // محطة B بطيئة: أثناء الانتظار يجب ألا يبقى شيء من A على الشاشة.
    const pending = server.hold((url) => url.includes('/products'));
    await userEvent.selectOptions(await stationSelect(), 'b');
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.queryByText('Beta')).toBeNull();
    expect(screen.queryByText(/9\.50/)).toBeNull();
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);

    await act(async () => { pending.release(); });
    expect(await screen.findByText('Delta')).toBeTruthy();
    expect(await screen.findByText(/12\.00/)).toBeTruthy(); // سعر المؤسسة الافتراضي
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(server.callsTo('station_id=b').length).toBeGreaterThan(0);
  });

  it('discards a late answer for the station that was left', async () => {
    seedUser();
    const server = connect(tenantData());
    const slowA = server.hold((url) => url.includes('/nozzles'));
    renderOps(<HomeScreen />);
    await stationSelect();
    // A ما زالت تحمّل؛ يبدّل المستخدم إلى B قبل وصولها.
    await userEvent.selectOptions(await stationSelect(), 'b');
    // ردّ A المتأخر لا يجب أن يغيّر شاشة B. (كل الطلبات المعلّقة مشتركة بالمسار فنحرّرها معاً بعد وصول B.)
    await act(async () => { slowA.release(); });
    expect(await screen.findByText('Delta')).toBeTruthy();
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('remembers the choice per tenant+user, not across them', async () => {
    seedUser();
    connect(tenantData());
    renderOps(<HomeScreen />);
    await userEvent.selectOptions(await stationSelect(), 'b');
    expect(localStorage.getItem(stationPreferenceKey('T1', 'u1'))).toBe('b');
    expect(localStorage.getItem(stationPreferenceKey('T2', 'u1'))).toBeNull();
    expect(localStorage.getItem(stationPreferenceKey('T1', 'u2'))).toBeNull();
  });
});

describe('tenant and branch isolation', () => {
  it('drops everything when the session switches to another tenant, and loads only that tenant\'s data', async () => {
    seedUser({ tenant_id: 'T1' });
    const first = connect(tenantData('one-'));
    renderOps(<HomeScreen />);
    expect(await screen.findByText('one-Alpha')).toBeTruthy();
    await userEvent.selectOptions(await stationSelect(), 'one-b');
    expect(await screen.findByText('one-Delta')).toBeTruthy();

    // دخول حساب مستأجر آخر في التبويب نفسه، وخادمه يعيد بياناته هو فقط.
    const second = connect(tenantData('two-'));
    const slow = second.hold((url) => url.includes('/stations'));
    act(() => {
      seedUser({ id: 'u9', tenant_id: 'T2', name: 'Other Tenant User' });
      window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
    });
    expect(screen.queryByText('one-Delta')).toBeNull();
    expect(screen.queryByText('one-Alpha')).toBeNull();
    expect(screen.queryByText('Station A')).toBeNull();
    await act(async () => { slow.release(); });
    expect(await screen.findByText('two-Alpha')).toBeTruthy();
    expect(screen.queryByText(/one-/)).toBeNull();
    // اختيار المستأجر الأول (one-b) لا يُورَّث للمستأجر الثاني.
    expect(((await stationSelect()) as HTMLSelectElement).value).toBe('two-a');
    expect(first.calls.some((call) => call.includes('two-'))).toBe(false);
  });

  it('reloads from scratch when the active branch changes', async () => {
    seedUser();
    const server = connect(tenantData());
    renderOps(<HomeScreen />);
    await screen.findByText('Alpha');
    const before = server.callsTo('/fuel-stations/stations').length;

    const slow = server.hold((url) => url.includes('/fuel-stations/stations'));
    act(() => { setActiveBranchId('branch-2'); });
    expect(screen.queryByText('Alpha')).toBeNull();
    await act(async () => { slow.release(); });
    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(server.callsTo('/fuel-stations/stations').length).toBeGreaterThan(before);
  });

  it('asks for shifts in the SELECTED station\'s own branch (X-Branch-Id), not whatever branch is active', async () => {
    seedUser();
    const data = tenantData();
    data.stations = [{ ...data.stations[0], branch_id: 'branch-A' }, { ...data.stations[1], branch_id: 'branch-B' }];
    data.shifts = [makeShift('sb1', 'b', { number: 'SH-B1' })];
    const server = connect(data);
    nav.pathname = '/fuel-stations/ops';
    renderOps(<HomeScreen />);
    await screen.findByText('Alpha');
    await userEvent.selectOptions(await stationSelect(), 'b');
    expect(await screen.findByText('SH-B1')).toBeTruthy();
    const shiftCalls = server.headersByCall.filter((call) => call.url.includes('/fuel-stations/shifts'));
    expect(shiftCalls.some((call) => call.url.includes('station_id=b') && call.headers['X-Branch-Id'] === 'branch-B')).toBe(true);
    expect(shiftCalls.filter((call) => call.url.includes('station_id=a')).every((call) => call.headers['X-Branch-Id'] === 'branch-A')).toBe(true);
    // الأصول والأسعار لا تحمل فرعاً مفروضاً من الواجهة.
    expect(server.headersByCall.filter((call) => call.url.includes('/products')).every((call) => call.headers['X-Branch-Id'] === undefined)).toBe(true);
  });

  it('a station without a branch sends no branch override', async () => {
    seedUser();
    const data = tenantData();
    data.shifts = [makeShift('s1', 'a')];
    const server = connect(data);
    renderOps(<HomeScreen />);
    await screen.findByText('SH-s1');
    expect(server.headersByCall.filter((call) => call.url.includes('/shifts')).every((call) => call.headers['X-Branch-Id'] === undefined)).toBe(true);
  });

  it('reloads from scratch when AWJ changes the user\'s authorized branches while the workspace is open', async () => {
    seedUser({ branch_ids: [] });
    const server = connect(tenantData());
    renderOps(<HomeScreen />);
    await screen.findByText('Alpha');
    const before = server.callsTo('/fuel-stations/stations').length;
    const slow = server.hold((url) => url.includes('/fuel-stations/stations'));
    act(() => {
      localStorage.setItem('user', JSON.stringify({ ...JSON.parse(localStorage.getItem('user') as string), branch_ids: ['branch-A'] }));
      window.dispatchEvent(new Event('nibras:user-changed'));
    });
    expect(screen.queryByText('Alpha')).toBeNull(); // لا بقايا نطاق الوصول السابق
    await act(async () => { slow.release(); });
    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(server.callsTo('/fuel-stations/stations').length).toBeGreaterThan(before);
  });

  it('listens to the branch event name used by the rest of AWJ', () => {
    expect(BRANCH_CHANGED_EVENT).toBe('nibras:branch-changed');
  });
});

describe('honest states', () => {
  it.each([
    [403, 'You don\'t have permission to view this'],
    [404, 'Not found'],
    [500, 'Couldn\'t load data'],
  ])('stations answered %s', async (status, title) => {
    seedUser();
    connect(tenantData());
    backend.fail((url) => url.includes('/fuel-stations/stations'), new ApiError(status, 'x', {}));
    renderOps(<HomeScreen />);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('offline: explains, and Try again recovers', async () => {
    seedUser();
    connect(tenantData());
    let broken = true;
    const original = apiMock.getMockImplementation() as (path: string) => Promise<never>;
    apiMock.mockImplementation(async (path: string) => {
      if (broken && path.includes('/fuel-stations/stations')) throw new TypeError('Failed to fetch');
      return original(path);
    });
    renderOps(<HomeScreen />);
    expect(await screen.findByText("Can't connect")).toBeTruthy();
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Alpha')).toBeTruthy();
  });

  it('rejects a malformed response instead of rendering guessed numbers', async () => {
    seedUser();
    connect(tenantData());
    backend.fail((url) => url.includes('/fuel-stations/tanks'), undefined);
    const original = apiMock.getMockImplementation() as (path: string) => Promise<never>;
    apiMock.mockImplementation(async (path: string) => (path.includes('/fuel-stations/tanks') ? ({ data: [{ id: 't', capacity_milliliters: 'lots' }] } as never) : original(path)));
    renderOps(<ProductsScreen />);
    expect(await screen.findByText('Unexpected response')).toBeTruthy();
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('without fuel_stations.view: blocked, with no fuel API call at all', async () => {
    seedUser({ permissions: ['invoices.view'] });
    connect(tenantData());
    renderOps(<HomeScreen />);
    expect(await screen.findByText("You don't have permission to view this")).toBeTruthy();
    expect(backend.calls).toHaveLength(0);
  });

  it('preview/demo mode says so and never shows demo numbers as station data', async () => {
    seedUser();
    localStorage.setItem('demo', 'true');
    connect(tenantData());
    renderOps(<HomeScreen />);
    expect(await screen.findByText('Preview mode')).toBeTruthy();
    expect(backend.calls).toHaveLength(0);
  });

  it('shows the offline banner when the browser is offline', async () => {
    seedUser();
    connect(tenantData());
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    renderOps(<HomeScreen />);
    expect(await screen.findByText(/You are offline/)).toBeTruthy();
    vi.restoreAllMocks();
  });
});

describe('shifts', () => {
  const shifts = (stationId: string) => [
    makeShift('s1', stationId, { number: 'SH-001', status: 'open', operational_liters: '1250.5' }),
    makeShift('s2', stationId, { number: 'SH-002', status: 'closed', closed_at: '2026-11-03T13:00:00+00:00' }),
    makeShift('s3', stationId, { number: 'SH-003', status: 'approved', approved_at: '2026-11-02T13:00:00+00:00' }),
    makeShift('s4', stationId, { number: 'SH-004', status: 'approved' }),
    makeShift('s5', stationId, { number: 'SH-005', status: 'approved' }),
    makeShift('x1', 'b', { number: 'SH-OTHER', status: 'open' }),
  ];

  it('shows the current open shift on the home screen with real status and liters computed from the completed nozzles', async () => {
    seedUser();
    const data = tenantData();
    data.shifts = shifts('a');
    // الخادم يُبقي إجمالي الوردية المفتوحة 0/قديماً حتى الإغلاق (هنا '1250.5' عمداً): يجب ألا يُعرض. الرقم من قراءات الفوهات المكتملة.
    data.details = { s1: shiftDetail('s1', 'a', { number: 'SH-001', operational_liters: '1250.5', meter_readings: [meter('m1', 'n1', 'opening', 100_000_000), meter('m2', 'n1', 'closing', 100_690_500)] }) };
    connect(data);
    renderOps(<HomeScreen />);
    expect(await screen.findByText('SH-001')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(await screen.findByText('690.500')).toBeTruthy();
    expect(screen.getByText('690.500').nextElementSibling?.textContent).toBe('L');
    expect(screen.queryByText('1,250.5')).toBeNull();
    expect(screen.getByText(/Partial total/)).toBeTruthy(); // n2 لم تكتمل
    expect(screen.queryByText('SH-OTHER')).toBeNull();
  });

  it('says there is no open shift (and does not invent one)', async () => {
    seedUser();
    connect(tenantData());
    renderOps(<HomeScreen />);
    expect(await screen.findByText('No open shift')).toBeTruthy();
  });

  it('does not query shifts without fuel.shift.view', async () => {
    seedUser({ permissions: ['fuel_stations.view'] });
    connect(tenantData());
    renderOps(<HomeScreen />);
    expect(await screen.findByText("Shifts aren't available for your permissions")).toBeTruthy();
    expect(backend.callsTo('/shifts')).toHaveLength(0);
  });

  it('paginates with an explicit Load more, never presenting page one as everything, without duplicates', async () => {
    seedUser();
    const data = tenantData();
    data.shifts = shifts('a');
    connect(data, { pageSize: 2 });
    nav.pathname = '/fuel-stations/ops/shifts';
    renderOps(<ShiftsScreen />);

    expect(await screen.findByText('SH-001')).toBeTruthy();
    expect(screen.getByText('SH-002')).toBeTruthy();
    expect(screen.queryByText('SH-003')).toBeNull();
    expect(screen.queryByText('You’ve reached the end of the list')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('SH-003')).toBeTruthy();
    expect(screen.getByText('SH-004')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('SH-005')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.getByText(/reached the end of the list/)).toBeTruthy();
    expect(screen.getAllByText(/^SH-00\d$/)).toHaveLength(5);
  });

  it('filters server-side by status and resets the list when the filter changes', async () => {
    seedUser();
    const data = tenantData();
    data.shifts = shifts('a');
    const server = connect(data);
    nav.pathname = '/fuel-stations/ops/shifts';
    renderOps(<ShiftsScreen />);
    await screen.findByText('SH-001');
    await userEvent.click(screen.getByRole('button', { name: 'Awaiting approval' }));
    expect(await screen.findByText('SH-002')).toBeTruthy();
    expect(screen.queryByText('SH-001')).toBeNull();
    expect(server.callsTo('status=closed').length).toBeGreaterThan(0);
  });

  it('is read-only: there is no button that opens, closes, approves or records anything', async () => {
    seedUser({ permissions: [...VIEW, 'fuel.shift.open', 'fuel.shift.approve'] });
    const data = tenantData();
    data.shifts = shifts('a');
    connect(data);
    nav.pathname = '/fuel-stations/ops/shifts';
    renderOps(<ShiftsScreen />);
    await screen.findByText('SH-001');
    const names = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    for (const name of names) expect(name).not.toMatch(/\b(open shift|close shift|approve shift|record|save|submit|confirm)\b/i);
  });
});

describe('role-aware navigation and honest "coming soon"', () => {
  it('shows only the screens the permissions allow', async () => {
    seedUser({ permissions: ['fuel_stations.view'] });
    connect(tenantData());
    renderOps(<HomeScreen />);
    await screen.findByText('Alpha');
    const navigation = screen.getByRole('navigation', { name: /Station Operations main navigation/ });
    expect(within(navigation).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Products', 'Tanks', 'Profile']);
  });

  const withOpenShift = (readings: Parameters<typeof shiftDetail>[2] = {}) => {
    const data = tenantData();
    data.shifts = [makeShift('s1', 'a', { number: 'SH-001', status: 'open' })];
    data.details = { s1: shiftDetail('s1', 'a', { number: 'SH-001', ...readings }) };
    return data;
  };

  it('an operator sees THEIR next step with ONE in-app action (the readings entry); the card itself stays text', async () => {
    seedUser({ permissions: [...VIEW, 'fuel.shift.open'] });
    connect(withOpenShift());
    renderOps(<HomeScreen />);
    const action = await screen.findByRole('link', { name: 'Record the starting meter readings' });
    expect(action.getAttribute('href')).toBe('/fuel-stations/ops/shifts/s1/readings/opening');
    expect(document.querySelectorAll('[data-primary-action]')).toHaveLength(1);
    const card = document.querySelector('[data-next-step]') as HTMLElement;
    expect(within(card).getByText('Next step')).toBeTruthy();
    expect(card.querySelector('a, button')).toBeNull(); // الزر الأساسي واحد في الشاشة، خارج البطاقة
    expect(card.textContent).not.toContain('soon');
    expect(screen.queryByText('Approve the shift')).toBeNull();
  });

  it('a user without the permission sees who the shift is waiting for, not an action', async () => {
    seedUser({ permissions: VIEW });
    connect(withOpenShift());
    renderOps(<HomeScreen />);
    const card = (await screen.findByText(/Waiting for: Record the starting meter readings/)).closest('section') as HTMLElement;
    expect(card.textContent).not.toContain('This step will arrive inside the app soon');
    // بلا صلاحية الخطوة: الزر الأساسي يعرض الوردية فقط، لا إجراء كتابة
    expect(screen.queryByRole('link', { name: 'Record the starting meter readings' })).toBeNull();
    expect(screen.getByRole('link', { name: /current shift/i }).getAttribute('href')).toBe('/fuel-stations/ops/shifts/s1');
  });

  it('the next step moves with the real shift state: meters AND the required tank readings both gate the stage', async () => {
    seedUser({ permissions: [...VIEW, 'fuel.shift.open'] });
    // كل عدادات البداية مسجَّلة لكن خزانات المحطة (إلزامية افتراضياً) لا — تبقى الخطوة قراءات البداية
    connect(withOpenShift({ meter_readings: ['n1', 'n2'].map((id, i) => meter(`o${i}`, id, 'opening', 100)) }));
    renderOps(<HomeScreen />);
    expect(await screen.findByRole('link', { name: 'Record the starting meter readings' })).toBeTruthy();
    expect(screen.getByText('Readings remaining: 2')).toBeTruthy();
    cleanup();

    // بعد تسجيل قراءات الخزانات للبداية تنتقل الخطوة إلى النهاية، والمتبقي = فوهتا المحطة + خزانان
    connect(withOpenShift({
      meter_readings: ['n1', 'n2'].map((id, i) => meter(`o${i}`, id, 'opening', 100)),
      tank_readings: [tankReading('to1', 't1', 'opening', 1_000), tankReading('to2', 't2', 'opening', 1_000)],
    }));
    renderOps(<HomeScreen />);
    expect(await screen.findByRole('link', { name: 'Record the ending meter readings' })).toBeTruthy();
    expect(screen.getByText('Readings remaining: 4')).toBeTruthy();
  });

  it('when the station policy is known and does not require tank readings, only meters gate the stage', async () => {
    seedUser({ permissions: [...VIEW, 'fuel.shift.open'] });
    const data = withOpenShift({ meter_readings: ['n1', 'n2'].map((id, i) => meter(`o${i}`, id, 'opening', 100)) });
    data.settings = {
      a: {
        shift_opening_meter_reading_required: true, shift_closing_meter_reading_required: true, shift_opening_tank_reading_required: false,
        shift_closing_tank_reading_required: false, shift_opening_cash_float_required: true, shift_mandatory_staff_assignment: false,
      },
    };
    connect(data);
    renderOps(<HomeScreen />);
    expect(await screen.findByRole('link', { name: 'Record the ending meter readings' })).toBeTruthy();
    expect(screen.getByText('Readings remaining: 2')).toBeTruthy();
  });

  it('a permission change is reflected without trusting stale privileges', async () => {
    seedUser({ permissions: [...VIEW, 'fuel.shift.open'], role: 'cashier' });
    connect(withOpenShift());
    renderOps(<HomeScreen />);
    await screen.findByRole('link', { name: 'Record the starting meter readings' });
    act(() => {
      localStorage.setItem('user', JSON.stringify({ ...JSON.parse(localStorage.getItem('user') as string), permissions: VIEW }));
      window.dispatchEvent(new Event('nibras:user-changed'));
    });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Record the starting meter readings' })).toBeNull());
    expect(await screen.findByText(/Waiting for: Record the starting meter readings/)).toBeTruthy();
  });
});

describe('settings and profile come from AWJ', () => {
  it('profile shows identity, role and scope read-only, and logs out through AWJ', async () => {
    seedUser({ role: 'cashier' });
    connect(tenantData());
    nav.pathname = '/fuel-stations/ops/profile';
    renderOps(<ProfileScreen />);
    expect(await screen.findByText('Sami Operator')).toBeTruthy();
    expect(screen.getByText('sami@example.test')).toBeTruthy();
    expect(screen.getByText('Cashier')).toBeTruthy();
    expect(screen.getByText('All branches')).toBeTruthy();
    expect((await screen.findAllByText('Station A')).length).toBeGreaterThan(0);
    // لا حقل تحرير للدور أو الصلاحيات.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /role/i })).toBeNull();
    // القرار 2026-11-05: لا روابط خروج إلى صفحات ERP من تطبيق الموظف (لا «إعدادات الأمان في AWJ»).
    expectAllLinksInApp();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/fuel-stations/ops/login'));
    expect(apiMock).toHaveBeenCalledWith('/logout', expect.objectContaining({ method: 'POST' }));
  });

  it('profile works even for a user without station access', async () => {
    seedUser({ permissions: [] });
    connect(tenantData());
    nav.pathname = '/fuel-stations/ops/profile';
    renderOps(<ProfileScreen />);
    expect(await screen.findByText('Sami Operator')).toBeTruthy();
    expect(await screen.findByText("Couldn't load stations")).toBeTruthy();
    expect(screen.getAllByText('Not allowed').length).toBe(5);
  });

  it('settings: language and theme are local preferences; station data is display-only', async () => {
    seedUser();
    connect(tenantData());
    nav.pathname = '/fuel-stations/ops/settings';
    renderOps(<SettingsScreen />);
    expect(await screen.findByText('My preferences on this device')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByText('Current station')).toBeTruthy();
    expect(screen.getByText(/can't be edited from this app/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Manage station settings/ })).toBeNull();
  });

  it('settings: even managers get no link out to ERP administration', async () => {
    seedUser({ permissions: [...VIEW, 'fuel_stations.manage'] });
    connect(tenantData());
    nav.pathname = '/fuel-stations/ops/settings';
    renderOps(<SettingsScreen />);
    await screen.findByText('Current station');
    expect(screen.queryByRole('link', { name: /Manage station settings/ })).toBeNull();
    expectAllLinksInApp();
  });
});

describe('branding and i18n', () => {
  it('uses the tenant name from AWJ settings, with a neutral AWJ mark when there is no logo', async () => {
    seedUser();
    connect(tenantData());
    company.value = { name: 'Zeta Energy', logo: null };
    renderOps(<HomeScreen />);
    expect(await screen.findByText('Zeta Energy')).toBeTruthy();
    expect(screen.getByText('AWJ Fuel Stations')).toBeTruthy();
    expect(screen.queryByText(/Nebras|نبراس/)).toBeNull();
  });

  it('renders the Arabic workspace with Latin digits and the product name', async () => {
    seedUser();
    connect(tenantData());
    const { container } = renderOps(<HomeScreen />, 'ar');
    expect(await screen.findByText('محطات أَوْج')).toBeTruthy();
    await screen.findByText('Alpha');
    expect(await screen.findByText(/9\.50/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/[٠-٩]/);
    expect(screen.getAllByText(/مضخة/).length).toBeGreaterThan(0);
  });
});

describe('accessibility', () => {
  it.each(['en', 'ar'] as const)('home has no axe violations (%s)', async (locale) => {
    seedUser({ permissions: [...VIEW, 'fuel.shift.approve'] });
    const data = tenantData();
    data.shifts = [makeShift('s1', 'a', { number: 'SH-001' })];
    connect(data);
    const { container } = renderOps(<HomeScreen />, locale);
    await screen.findByText('Alpha');
    await screen.findByText('SH-001');
    await screen.findByText(/9\.50/);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });

  it('the error and empty states are announced', async () => {
    seedUser();
    connect(tenantData());
    backend.fail((url) => url.includes('/fuel-stations/stations'), new ApiError(403, 'x', {}));
    renderOps(<HomeScreen />);
    expect((await screen.findByRole('alert')).textContent).toContain("You don't have permission to view this");
  });
});

describe('V2 composition (visual contract, PR #1990)', () => {
  it('masthead carries one action icon (settings) and the station field — no language/theme toggles', async () => {
    seedUser();
    connect(tenantData());
    const { container } = renderOps(<HomeScreen />);
    await screen.findByText('Alpha');
    const header = container.querySelector('header') as HTMLElement;
    const actions = [...header.querySelectorAll('a, button')].map((el) => el.getAttribute('aria-label'));
    expect(actions).toEqual(['Settings']);
    expect(header.querySelector('select')).not.toBeNull();
    expect(container.querySelectorAll('main').length).toBe(1);
    expect(container.querySelectorAll('h1').length).toBe(1);
  });

  it('the raised current-shift card shows the real shift; the big figure is liters computed from the meters (never a stored zero)', async () => {
    seedUser();
    const data = tenantData();
    data.shifts = [makeShift('s1', 'a', { number: 'SH-777', operational_liters: '0' })];
    // قراءة افتتاح 0 فعلية (عداد جديد) وإغلاق 5,740 لتراً: الفرق حقيقي، و«0» الأولى ليست «غائبة».
    data.details = { s1: shiftDetail('s1', 'a', { number: 'SH-777', meter_readings: [meter('m1', 'n1', 'opening', 0), meter('m2', 'n1', 'closing', 5_740_000), meter('m3', 'n2', 'opening', 10), meter('m4', 'n2', 'closing', 10)] }) };
    connect(data);
    const { container } = renderOps(<HomeScreen />);
    expect(await screen.findByText('SH-777')).toBeTruthy();
    expect(await screen.findByText('5,740.000')).toBeTruthy();
    expect(screen.queryByText(/Partial total/)).toBeNull(); // الفوهتان الفعّالتان مكتملتان
    // قرار 2026-11-05 (بساطة): لا بطاقتا «النقد/الشبكة» الدائمتا «غير متاح» — ضجيج بلا معلومة.
    expect(screen.queryByText('Not available yet')).toBeNull();
    expect(container.textContent).not.toMatch(/\b0\.00\b/);
  });

  it('without an open shift there is no liters figure at all (not a zero), and the card says so plainly', async () => {
    seedUser();
    connect(tenantData());
    renderOps(<HomeScreen />);
    await screen.findByText('No open shift');
    expect(screen.queryByText('Operational liters from meters')).toBeNull();
    expect(screen.queryByText(/Meter liters so far/)).toBeNull();
    expect(screen.getByText('There is no open shift at this station right now.')).toBeTruthy();
  });

  it('exactly ONE primary action on the home screen, and it stays inside the app', async () => {
    seedUser();
    const data = tenantData();
    data.shifts = [makeShift('s1', 'a', { number: 'SH-001', status: 'open' })];
    data.details = { s1: shiftDetail('s1', 'a', { number: 'SH-001' }) };
    connect(data);
    const { container } = renderOps(<HomeScreen />);
    const cta = await screen.findByRole('link', { name: /View the current shift/ });
    expect(cta.getAttribute('href')).toBe('/fuel-stations/ops/shifts/s1');
    expect(container.querySelectorAll('[data-primary-action]')).toHaveLength(1);
    expectAllLinksInApp();
  });

  it('without an open shift the primary action is the shift history (in-app), and only with shift permission', async () => {
    seedUser();
    connect(tenantData());
    renderOps(<HomeScreen />);
    const cta = await screen.findByRole('link', { name: 'Shift history' });
    expect(cta.getAttribute('href')).toBe('/fuel-stations/ops/shifts');
    cleanup();
    localStorage.clear();
    seedUser({ permissions: ['fuel_stations.view'] });
    connect(tenantData());
    renderOps(<HomeScreen />);
    await screen.findByText('Alpha');
    expect(container_primary()).toBe(0);
  });

  it('greets by time of day', async () => {
    seedUser();
    connect(tenantData());
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 4, 9, 0));
    renderOps(<HomeScreen />);
    expect(await screen.findByText('Good morning, Sami Operator')).toBeTruthy();
    cleanup();
    vi.setSystemTime(new Date(2026, 10, 4, 20, 0));
    renderOps(<HomeScreen />);
    expect(await screen.findByText('Good evening, Sami Operator')).toBeTruthy();
    vi.useRealTimers();
  });
});

/** قرار 2026-11-05: كل رابط في تطبيق الموظف داخل `/fuel-stations/ops` (عدا مرساة تخطّي المحتوى). */
const expectAllLinksInApp = () => {
  const links = screen.getAllByRole('link').filter((link) => !(link.getAttribute('href') ?? '').startsWith('#'));
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(link.getAttribute('href'), link.textContent ?? '').toMatch(/^\/fuel-stations\/ops(\/|$)/);
};
const container_primary = () => document.querySelectorAll('[data-primary-action]').length;
void fireEvent;
