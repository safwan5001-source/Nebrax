// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import { ApiError, api } from '@/lib/api';
import { AUTH_SESSION_CHANGED_EVENT, type AuthUser } from '@/lib/auth';
import { meter, nozzle, product, pump, shift as makeShift, shiftDetail, station, tank, tankReading } from './__fixtures__';
import { createBackend, type Backend, type TenantData } from './__test-harness';
import type { ShiftDetail } from './schemas';
import { ShiftDetailScreen } from './shift-detail-screen';
import { ShiftsScreen } from './shifts-screen';
import { StationOpsShell } from './shell';

const apiMock = vi.mocked(api);
const VIEW = ['fuel_stations.view', 'fuel.shift.view', 'fuel.sale.view'];

function seedUser(over: Partial<AuthUser> = {}): AuthUser {
  const user: AuthUser = { id: 'u1', name: 'Sami Operator', email: 'sami@example.test', role: 'cashier', tenant_id: 'T1', permissions: VIEW, branch_ids: [], warehouse_ids: [], ...over };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
  return user;
}

/** محطة A: مضختان وثلاث فوهات (n1,n2 على مضخة 1 — n3 على مضخة 2)؛ محطة B: فوهة واحدة. لا قائمة وقود ثابتة. */
function tenantData(): TenantData {
  return {
    stations: [station('a', { name: 'Station A', timezone: 'Asia/Riyadh', branch_id: 'branch-A' }), station('b', { name: 'Station B', timezone: 'Asia/Riyadh', branch_id: 'branch-B' })],
    products: [product('p1', 'Alpha'), product('p2', 'Beta')],
    pumps: [pump('pump1', 'a'), pump('pump2', 'a'), pump('pump9', 'b')],
    tanks: [tank('t1', 'a', 'p1'), tank('t2', 'a', 'p2'), tank('t9', 'b', 'p1')],
    nozzles: [
      nozzle('n1', 'a', 'pump1', 't1', 'p1'),
      nozzle('n2', 'a', 'pump1', 't2', 'p2'),
      nozzle('n3', 'a', 'pump2', 't1', 'p1'),
      nozzle('n9', 'b', 'pump9', 't9', 'p1'),
    ],
    prices: [],
    shifts: [],
  };
}

const CLOSED: Partial<ShiftDetail> = {
  number: 'SH-100',
  status: 'closed',
  opened_at: '2026-11-03T05:00:00+00:00',
  closed_at: '2026-11-03T13:00:00+00:00',
  operational_meter_milliliters: 1_190_500,
  meter_readings: [
    meter('m1', 'n1', 'opening', 125_430_000), meter('m2', 'n1', 'closing', 126_120_500),
    meter('m3', 'n2', 'opening', 0), meter('m4', 'n2', 'closing', 500_000),
  ],
};

let backend: Backend;

function connect(data: TenantData) {
  backend = createBackend(data);
  apiMock.mockImplementation(async (path: string, options?: { headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
    return backend.handler(path, options?.headers as Record<string, string> | undefined) as never;
  });
  return backend;
}

/** يحمّل شاشة التفاصيل لوردية s1 في المحطة A. */
function open(detail: Partial<ShiftDetail> = CLOSED, options: { data?: TenantData; locale?: 'en' | 'ar'; id?: string } = {}) {
  const data = options.data ?? tenantData();
  data.details = { ...data.details, s1: shiftDetail('s1', 'a', detail) };
  connect(data);
  return renderIntl(<StationOpsShell><ShiftDetailScreen shiftId={options.id ?? 's1'} /></StationOpsShell>, options.locale ?? 'en');
}

beforeEach(() => {
  localStorage.clear();
  nav.pathname = '/fuel-stations/ops/shifts/s1';
  apiMock.mockReset();
  seedUser();
});
afterEach(cleanup);

/** قسم مطوي بعنوان ملخصه (التفاصيل الثانوية مطوية افتراضياً). */
const more = (title: string) => (screen.getByText(title, { selector: 'summary' }).closest('details') as HTMLElement);
const pumpCard = (name: RegExp) => screen.getByRole('heading', { level: 3, name }).closest('li') as HTMLElement;
/** صف فوهة داخل بطاقة مضخة (نصّه مقسَّم على عناصر فلا يصلح getByText). */
const nozzleRow = (card: HTMLElement, number: string) => {
  const row = within(card).getAllByRole('listitem').find((item) => (item.textContent ?? '').startsWith(`Nozzle ${number}`));
  if (!row) throw new Error(`no row for nozzle ${number}`);
  return row;
};

describe('shift details — readings from the real contract', () => {
  it('lists the shift by pump → nozzle with product, tank, opening, closing and the computed quantity', async () => {
    open();
    expect(await screen.findByText('SH-100')).toBeTruthy();
    const p1 = pumpCard(/Pump 1/);
    const n1 = nozzleRow(p1, '1');
    expect(within(n1).getByText('Alpha', { exact: false })).toBeTruthy();
    expect(within(n1).getByText('Tank t1')).toBeTruthy();
    expect(within(n1).getByText('125,430.000')).toBeTruthy();
    expect(within(n1).getByText('126,120.500')).toBeTruthy();
    expect(within(n1).getByText('690.500')).toBeTruthy();
    expect(within(n1).getByText('Complete')).toBeTruthy();
    // الوحدة نص عادي خارج الرقم
    expect(within(n1).getByText('690.500').nextElementSibling?.textContent).toBe('L');
    // مضخة 2: فوهة n3 بلا قراءات في وردية مغلقة ⇒ لا تُعرض كأنها «ناقصة» (الإعداد الحالي قد يختلف عن ماضي الوردية)
    expect(screen.queryByRole('heading', { level: 3, name: /Pump 2/ })).toBeNull();
  });

  it('a real zero reading is shown as 0.000 and is not confused with a missing one', async () => {
    open();
    await screen.findByText('SH-100');
    const n2 = nozzleRow(pumpCard(/Pump 1/), '2');
    expect(within(n2).getByText('0.000')).toBeTruthy(); // قراءة افتتاح 0 فعلية
    expect(within(n2).queryByText('Not recorded')).toBeNull();
  });

  it('only issues GET requests, to the shift-detail endpoint, in the selected station\'s branch', async () => {
    open();
    await screen.findByText('SH-100');
    for (const call of apiMock.mock.calls) {
      const init = call[1] as { method?: string } | undefined;
      expect(init?.method ?? 'GET').toBe('GET');
    }
    const detailCalls = backend.headersByCall.filter((call) => call.url === '/fuel-stations/shifts/s1');
    expect(detailCalls.length).toBeGreaterThan(0);
    expect(detailCalls.every((call) => call.headers['X-Branch-Id'] === 'branch-A')).toBe(true);
  });

  it('shows the server total of a closed shift and its duration in the station time zone', async () => {
    open();
    expect(await screen.findByText('1,190.500')).toBeTruthy();
    expect(screen.getByText('Shift liters from the meters')).toBeTruthy();
    expect(screen.getByText('Duration: 8 h 0 m')).toBeTruthy();
    expect(screen.queryByText(/has no time zone set/)).toBeNull(); // المنطقة معروفة: لا ضجيج
    expect(screen.getByText('Step 5 of 5: Shift approved')).toBeTruthy();
    // 05:00 UTC = 08:00 AM الرياض
    expect(screen.getAllByText(/3 Nov 2026, 08:00\sAM/).length).toBeGreaterThan(0);
  });

  it('states plainly that meter liters are not sales, collections or stock', async () => {
    open();
    await screen.findByText('SH-100');
    expect(screen.getByText(/pump meters only — not sales, not collections and not stock/)).toBeTruthy();
  });

  it('warns when the server total disagrees with the nozzle differences shown', async () => {
    open({ ...CLOSED, operational_meter_milliliters: 9_999_000 });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/9,999\.000/);
    expect(alert.textContent).toMatch(/1,190\.500/);
  });

  it('flags a closing reading below the opening reading and leaves it out of the total', async () => {
    open({
      ...CLOSED,
      operational_meter_milliliters: 0,
      meter_readings: [meter('m1', 'n1', 'opening', 900_000), meter('m2', 'n1', 'closing', 100_000)],
    });
    await screen.findByText('SH-100');
    const n1 = nozzleRow(pumpCard(/Pump 1/), '1');
    expect(within(n1).getByText('Needs review')).toBeTruthy();
    expect(within(n1).getByText('Closing reading is lower than opening')).toBeTruthy();
    expect(screen.getByText(/closing reading is lower than the opening reading: 1/)).toBeTruthy();
  });

  it('keeps readings of a nozzle that is not in the station\'s current setup and says so', async () => {
    open({ ...CLOSED, operational_meter_milliliters: 300, meter_readings: [meter('m1', 'gone', 'opening', 0), meter('m2', 'gone', 'closing', 300)] });
    expect(await screen.findByText("Nozzles outside the station's current setup")).toBeTruthy();
    expect(screen.getByText('Unknown nozzle')).toBeTruthy();
    expect(screen.getAllByText('0.300')).toHaveLength(3); // الإغلاق، والكمية المحسوبة، وإجمالي الوردية
  });

  it('shows the tank measurements with their type, and says they do not change stock', async () => {
    open({ ...CLOSED, tank_readings: [tankReading('r1', 't1', 'opening', 9_000_000), tankReading('r2', 't1', 'closing', 8_250_000, { reading_type: 'atg' })] });
    await screen.findByText('SH-100');
    const section = more('Tank readings');
    expect(within(section).getByText('Tank t1')).toBeTruthy();
    expect(within(section).getByText('9,000.000')).toBeTruthy();
    expect(within(section).getByText('8,250.000')).toBeTruthy();
    expect(within(section).getByText('Physical measurement')).toBeTruthy();
    expect(within(section).getByText('Automatic gauge (ATG)')).toBeTruthy();
    expect(within(section).getByText(/don't change stock/)).toBeTruthy();
  });
});

describe('open shift — the stored total is not a real zero', () => {
  const OPEN: Partial<ShiftDetail> = { number: 'SH-200', status: 'open', closed_at: null, operational_liters: '0', operational_meter_milliliters: 0 };

  it('with no complete nozzle the figure is "—" and says nothing is computed yet (never 0)', async () => {
    open({ ...OPEN, meter_readings: [meter('m1', 'n1', 'opening', 100)] });
    await screen.findByText('SH-200');
    const figure = screen.getByText('Meter liters so far').nextElementSibling as HTMLElement;
    expect(figure.textContent).toBe('—');
    expect(screen.getByText(/No nozzle has both readings yet/)).toBeTruthy();
  });

  it('computes from complete nozzles only and labels the total partial, with progress against the active nozzles', async () => {
    open({ ...OPEN, meter_readings: [meter('m1', 'n1', 'opening', 1_000_000), meter('m2', 'n1', 'closing', 1_400_000), meter('m3', 'n2', 'opening', 5)] });
    await screen.findByText('SH-200');
    const figure = screen.getByText('Meter liters so far').nextElementSibling as HTMLElement;
    expect(figure.textContent).toContain('400.000');
    expect(screen.getByText('Partial total: only nozzles with both opening and closing readings are counted (1 of 3).')).toBeTruthy();
    const progress = more('Shift progress');
    expect(within(progress).getByText('Opening readings').closest('li')?.textContent).toMatch(/2 of 3 nozzles/);
    // كل فوهة فعّالة تظهر، ومن لم تُسجَّل لها قراءة صريحة
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    expect(within(pumpCard(/Pump 2/)).getByText('Not recorded', { selector: 'span' })).toBeTruthy();
  });

  it('marks the next progress step and keeps only the three AWJ states (no invented ones)', async () => {
    open({ ...OPEN });
    await screen.findByText('SH-200');
    const progress = more('Shift progress');
    const current = progress.querySelector('[aria-current="step"]') as HTMLElement;
    expect(current.textContent).toContain('Opening readings');
    expect(current.textContent).toContain('Next');
    expect(screen.getByText('Step 2 of 5: Opening readings')).toBeTruthy(); // الملخص المضغوط في البطاقة العليا
    expect(progress.textContent).not.toMatch(/returned|submitted|rejected/i);
    expect(progress.querySelectorAll('li')).toHaveLength(5); // حالات أَوْج الثلاث + قراءات الافتتاح/الإغلاق فقط
  });

  it('cash that has not been counted is "Not counted yet", not zero', async () => {
    open({ ...OPEN, counted_cash_minor: null, expected_operational_cash_minor: null, cash_variance_minor: null });
    await screen.findByText('SH-200');
    expect(within(more('Cash in this shift')).getAllByText('Not counted yet')).toHaveLength(3);
  });
});

describe('cash', () => {
  it('names the direction of a variance with text, not colour alone', async () => {
    open({ ...CLOSED, opening_float_minor: 10_000, counted_cash_minor: 9_500, expected_operational_cash_minor: 10_000, cash_variance_minor: -500, cash_variance: { status: 'pending_review', variance_direction: 'shortage' } });
    await screen.findByText('SH-100');
    const section = more('Cash in this shift');
    expect(within(section).getByText('Shortage')).toBeTruthy();
    expect(within(section).getByText('Pending review')).toBeTruthy();
    expect(within(section).getByText(/not sales and not card\/network collections/)).toBeTruthy();
  });

  it('a counted, matching shift is "Matches" (a real zero), an overage is "Overage"', async () => {
    open({ ...CLOSED, counted_cash_minor: 100, expected_operational_cash_minor: 100, cash_variance_minor: 0 });
    expect(await screen.findByText('Matches')).toBeTruthy();
    cleanup();
    apiMock.mockReset();
    open({ ...CLOSED, counted_cash_minor: 150, expected_operational_cash_minor: 100, cash_variance_minor: 50 });
    expect(await screen.findByText('Overage')).toBeTruthy();
  });
});

describe('time zone', () => {
  it('says when the station has no time zone and uses the device zone', async () => {
    const data = tenantData();
    data.stations[0] = station('a', { name: 'Station A', timezone: null, branch_id: 'branch-A' });
    open(CLOSED, { data });
    expect(await screen.findByText("This station has no time zone set; times use your device's time zone.")).toBeTruthy();
  });

  it('a span across midnight shows the date on every stamp (21:30 UTC is the next day in Riyadh)', async () => {
    open({ ...CLOSED, opened_at: '2026-11-03T20:00:00+00:00', closed_at: '2026-11-04T04:00:00+00:00', meter_readings: [meter('m1', 'n1', 'opening', 0, { measured_at: '2026-11-03T21:30:00+00:00' }), meter('m2', 'n1', 'closing', 1_000)], operational_meter_milliliters: 1_000 });
    await screen.findByText('SH-100');
    const n1 = nozzleRow(pumpCard(/Pump 1/), '1');
    expect(within(n1).getByText(/4 Nov 2026, 12:30\sAM/)).toBeTruthy();
  });
});

describe('assigned staff', () => {
  it('shows the number of assigned staff and marks the viewer, without exposing other people\'s ids', async () => {
    open({ ...CLOSED, staff_assignments: [{ user_id: 'u1' }, { user_id: 'someone-else' }] });
    expect(await screen.findByText('Assigned to the shift: 2')).toBeTruthy();
    expect(screen.getByText('You are assigned')).toBeTruthy();
    expect(document.body.textContent).not.toContain('someone-else');
  });
});

describe('scope and isolation', () => {
  it('a shift that belongs to another station is "not available" — its data never reaches the screen', async () => {
    const data = tenantData();
    data.details = { s9: shiftDetail('s9', 'b', { number: 'SH-OTHER', meter_readings: [meter('m1', 'n9', 'opening', 777_000)] }) };
    connect(data);
    renderIntl(<StationOpsShell><ShiftDetailScreen shiftId="s9" /></StationOpsShell>, 'en');
    expect(await screen.findByText('Shift not available')).toBeTruthy();
    expect(document.body.textContent).not.toContain('SH-OTHER');
    expect(document.body.textContent).not.toContain('777');
    expect(screen.getByRole('link', { name: 'Back to shifts' }).getAttribute('href')).toBe('/fuel-stations/ops/shifts');
  });

  it('a 404 from the server is "not available", and a 403 is a permission message (not conflated)', async () => {
    open(CLOSED, { id: 'missing' });
    expect(await screen.findByText('Shift not available')).toBeTruthy();
    cleanup();
    apiMock.mockReset();
    open();
    backend.fail((url) => url === '/fuel-stations/shifts/s1', new ApiError(403, 'x', {}));
    expect(await screen.findByText("You don't have permission to view this")).toBeTruthy();
    expect(screen.queryByText('Shift not available')).toBeNull();
  });

  it.each(['', '../sales', 'a/b', 'open'])('refuses to build a request from a malformed id %j', async (id) => {
    open(CLOSED, { id });
    expect(await screen.findByText('Shift not available')).toBeTruthy();
    expect(backend.callsTo('/fuel-stations/shifts')).toHaveLength(0);
  });

  it('without fuel.shift.view nothing is requested and the screen says why', async () => {
    seedUser({ permissions: ['fuel_stations.view'] });
    open();
    expect(await screen.findByText("Shifts aren't available for your permissions")).toBeTruthy();
    expect(backend.callsTo('/fuel-stations/shifts')).toHaveLength(0);
  });

  it('switching station clears the previous station\'s shift at once and never shows it under the new station', async () => {
    open();
    await screen.findByText('SH-100');
    const pending = backend.hold((url) => url.startsWith('/fuel-stations/shifts/s1'));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /station/i }), 'b');
    expect(screen.queryByText('SH-100')).toBeNull();
    expect(screen.queryByText('125,430.000')).toBeNull();
    await act(async () => { pending.release(); });
    expect(await screen.findByText('Shift not available')).toBeTruthy();
    expect(screen.queryByText('SH-100')).toBeNull();
  });

  it('a tenant switch drops the shift and loads only the new tenant\'s data', async () => {
    open();
    await screen.findByText('SH-100');
    const second = tenantData();
    second.details = { s1: shiftDetail('s1', 'a', { number: 'SH-TWO' }) };
    connect(second);
    const slow = backend.hold((url) => url.includes('/fuel-stations/stations'));
    act(() => {
      seedUser({ id: 'u9', tenant_id: 'T2' });
      window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT));
    });
    expect(screen.queryByText('SH-100')).toBeNull();
    await act(async () => { slow.release(); });
    expect(await screen.findByText('SH-TWO')).toBeTruthy();
    expect(screen.queryByText('SH-100')).toBeNull();
  });
});

describe('honest states', () => {
  it('keeps the last loaded data, with a clear notice, when a refresh fails — and recovers on retry', async () => {
    open();
    await screen.findByText('SH-100');
    backend.fail((url) => url === '/fuel-stations/shifts/s1', new TypeError('Failed to fetch'));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/Couldn't refresh; showing the last loaded data/)).toBeTruthy();
    expect(screen.getByText('125,430.000')).toBeTruthy(); // لم تُخفَ البيانات خلف خطأ
  });

  it('rejects a malformed or incomplete response instead of guessing numbers', async () => {
    open();
    const original = apiMock.getMockImplementation() as (path: string) => Promise<never>;
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/fuel-stations/shifts/s1') return { data: { ...shiftDetail('s1', 'a'), meter_readings: undefined } } as never;
      return original(path);
    });
    expect(await screen.findByText('Unexpected response')).toBeTruthy();
    expect(screen.queryByText('SH-100')).toBeNull();
  });

  it('a failure loading the pump/nozzle setup affects only the readings section', async () => {
    open();
    backend.fail((url) => url.includes('/fuel-stations/nozzles'), new ApiError(500, 'x', {}));
    expect(await screen.findByText('SH-100')).toBeTruthy();
    expect(await screen.findByText("Couldn't load the pumps and nozzles needed to show the readings.")).toBeTruthy();
    expect(more('Cash in this shift')).toBeTruthy();
    expect(screen.queryByText('125,430.000')).toBeNull();
  });

  it('an empty shift says there are no readings', async () => {
    open({ ...CLOSED, operational_meter_milliliters: 0, meter_readings: [] });
    expect(await screen.findByText('No meter readings')).toBeTruthy();
  });
});

describe('read-only and app-only', () => {
  it('has no control that records, closes, approves or opens anything: the only button is Refresh', async () => {
    seedUser({ permissions: [...VIEW, 'fuel.shift.open', 'fuel.shift.approve'] });
    open();
    await screen.findByText('SH-100');
    // الزر الوحيد الآخر هو «مساعدة هذه الشاشة» (مقروء فقط: يفتح ورقة شرح ولا يكتب شيئاً).
    const controls = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-label') !== 'Help for this screen');
    expect(controls.map((button) => button.textContent?.trim())).toEqual(['Refresh']);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('every link stays inside the app — no hop to ERP shift/settings pages (product decision 2026-11-05)', async () => {
    seedUser({ permissions: [...VIEW, 'fuel.shift.open', 'fuel.shift.approve', 'fuel_stations.manage'] });
    open();
    await screen.findByText('SH-100');
    const links = screen.getAllByRole('link').filter((link) => !(link.getAttribute('href') ?? '').startsWith('#'));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute('href'), link.textContent ?? '').toMatch(/^\/fuel-stations\/ops(\/|$)/);
    expect(document.body.textContent).not.toMatch(/full shifts screen|in AWJ/i);
  });

  it('shows the NEXT STEP in the employee\'s language before the readings; an approver gets one in-app link to the review screen', async () => {
    seedUser({ permissions: [...VIEW, 'fuel.shift.approve'] });
    open();
    const card = (await screen.findByRole('link', { name: 'Review and approve the shift' })).closest('section') as HTMLElement;
    expect(card.textContent).toContain('Next step');
    expect(card.textContent).not.toContain('This step will arrive inside the app soon');
    expect(card.querySelector('button')).toBeNull();
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/fuel-stations/ops/shifts/s1/review');
    const readings = screen.getByRole('heading', { name: 'Meter readings' });
    expect(card.compareDocumentPosition(readings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // الخطوة التالية تسبق القراءات
  });

  it('an approved shift says it is complete (no action, no missing-message errors)', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(' ')); });
    open({ ...CLOSED, status: 'approved', approved_at: '2026-11-03T14:00:00+00:00' });
    expect(await screen.findByText('This shift is complete')).toBeTruthy();
    expect(screen.getByText('Shift complete')).toBeTruthy();
    expect(errors.filter((line) => /MISSING_MESSAGE/.test(line))).toEqual([]);
    spy.mockRestore();
  });

  it('secondary sections (progress, tanks, cash) are collapsed by default so the readings come first', async () => {
    open();
    await screen.findByText('SH-100');
    for (const title of ['Shift progress', 'Tank readings', 'Cash in this shift']) expect((more(title) as HTMLDetailsElement).open).toBe(false);
  });

  it('a viewer without the approve permission is told who the shift is waiting for', async () => {
    open();
    expect(await screen.findByText('Waiting for: Review and approve the shift')).toBeTruthy();
  });
});

describe('arabic and accessibility', () => {
  it('renders Arabic RTL copy with Latin digits only', async () => {
    open(CLOSED, { locale: 'ar' });
    expect(await screen.findByText('تفاصيل الوردية')).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).toContain('125,430.000');
    expect(text).not.toMatch(/[٠-٩۰-۹]/);
  });

  it.each(['en', 'ar'] as const)('has no axe violations (%s)', async (locale) => {
    seedUser({ permissions: [...VIEW, 'fuel.shift.open', 'fuel.shift.approve'] });
    const { container } = open({ ...CLOSED, tank_readings: [tankReading('r1', 't1', 'opening', 9_000_000)], staff_assignments: [{ user_id: 'u1' }] }, { locale });
    await screen.findByText('SH-100');
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});

describe('shifts list → details', () => {
  function openList() {
    const data = tenantData();
    data.shifts = [
      makeShift('s1', 'a', { number: 'SH-OPEN', status: 'open', operational_liters: '0' }),
      makeShift('s2', 'a', { number: 'SH-DONE', status: 'closed', operational_liters: '1190.5', closed_at: '2026-11-03T13:00:00+00:00' }),
    ];
    connect(data);
    nav.pathname = '/fuel-stations/ops/shifts';
    return renderIntl(<StationOpsShell><ShiftsScreen /></StationOpsShell>, 'en');
  }

  it('an open shift never shows the stored 0 as liters; a closed one shows the server total; both link to their details', async () => {
    openList();
    const open = (await screen.findByText('SH-OPEN')).closest('article') as HTMLElement;
    const done = screen.getByText('SH-DONE').closest('article') as HTMLElement;
    expect(within(open).getByText(/Computed when the shift closes/)).toBeTruthy();
    expect(within(open).queryByText('0')).toBeNull();
    expect(within(done).getByText('1,190.5')).toBeTruthy();
    expect(within(open).getByRole('link', { name: /View details/ }).getAttribute('href')).toBe('/fuel-stations/ops/shifts/s1');
    expect(within(done).getByRole('link', { name: /View details/ }).getAttribute('href')).toBe('/fuel-stations/ops/shifts/s2');
  });
});
