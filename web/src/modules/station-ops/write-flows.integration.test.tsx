// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/shifts/open', replace: vi.fn(), refresh: vi.fn() }));

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
import { meter, nozzle, product, pump, shift as makeShift, shiftDetail, station, tank, tankReading } from './__fixtures__';
import type { TenantData } from './__test-harness';
import { createWriteBackend, type WriteBackend } from './__write-backend';
import { HandoverScreen } from './handover-screen';
import { OpenShiftScreen } from './open-shift-screen';
import { ReadingsEntryScreen } from './readings-entry-screen';
import type { ShiftDetail } from './schemas';
import { StationOpsShell } from './shell';

const apiMock = vi.mocked(api);
const SELLER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close'];
const WHITELIST = /^\/fuel-stations\/shifts\/(open|[\w-]+\/(staff|meter-readings|tank-readings|cash-movements|close))$/;

function seedUser(permissions: string[] = SELLER): AuthUser {
  const user: AuthUser = { id: 'u1', name: 'Sami Operator', email: 'sami@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
  return user;
}

/** محطة A: مضختان وفوهتان (n1,n2) وخزانان (t1,t2). لا قائمة وقود ثابتة. */
function baseData(): TenantData {
  return {
    stations: [station('a', { name: 'Station A', timezone: 'Asia/Riyadh' })],
    products: [product('p1', 'Alpha'), product('p2', 'Beta')],
    pumps: [pump('pump1', 'a'), pump('pump2', 'a')],
    tanks: [tank('t1', 'a', 'p1'), tank('t2', 'a', 'p2')],
    nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1'), nozzle('n2', 'a', 'pump2', 't2', 'p2')],
    prices: [],
    shifts: [],
  };
}

function withShift(over: Partial<ShiftDetail> = {}, data: TenantData = baseData()): TenantData {
  data.shifts = [makeShift('s1', 'a', { number: 'SH-001', status: 'open' })];
  data.details = { s1: shiftDetail('s1', 'a', { number: 'SH-001', opening_float_minor: 50_000, staff_assignments: [{ user_id: 'u1' }], cash_movements: [], ...over }) };
  return data;
}

const allReadings = (): Partial<ShiftDetail> => ({
  meter_readings: ['n1', 'n2'].flatMap((id, i) => [meter(`o${i}`, id, 'opening', 100_000), meter(`c${i}`, id, 'closing', 150_000)]),
  tank_readings: ['t1', 't2'].flatMap((id, i) => [tankReading(`to${i}`, id, 'opening', 9_000_000), tankReading(`tc${i}`, id, 'closing', 8_000_000)]),
});

let backend: WriteBackend;
function connect(data: TenantData, options: Parameters<typeof createWriteBackend>[1] = {}) {
  backend = createWriteBackend(data, options);
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
    return backend.handler(path, init) as never;
  });
  return backend;
}

beforeEach(() => {
  setOnline(true);
  localStorage.clear();
  sessionStorage.clear();
  apiMock.mockReset();
  seedUser();
});
afterEach(() => {
  cleanup();
  // كل POST أُرسل في أي اختبار ضمن القائمة البيضاء الست — لا اعتماد/مبيعات/تحصيل أبداً.
  for (const call of backend?.posts ?? []) expect(call.path, call.path).toMatch(WHITELIST);
});

const renderOps = (ui: React.ReactElement, locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell>{ui}</StationOpsShell>, locale);
const setOnline = (online: boolean) => Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
const field = (testId: string) => screen.findByTestId(testId) as Promise<HTMLInputElement>;
const buttonNamed = (name: string | RegExp) => screen.getByRole('button', { name });

/* ───────────────────────────── فتح الوردية ───────────────────────────── */

describe('open shift', () => {
  it('needs an explicit starting cash (no default zero) and an explicit confirmation, then registers the user', async () => {
    const user = userEvent.setup();
    connect(baseData());
    renderOps(<OpenShiftScreen />);
    const input = await field('open-float');
    expect(input.value).toBe('');
    expect((buttonNamed('Review and open the shift') as HTMLButtonElement).disabled).toBe(true);

    await user.type(input, '500');
    await user.click(buttonNamed('Review and open the shift'));
    expect(backend.posts).toHaveLength(0); // المراجعة لا ترسل شيئاً
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Station A')).toBeTruthy();
    expect(within(dialog).getByText('Sami Operator')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and open the shift' }));

    expect(await screen.findByText('Shift SH-NEW-1 is open')).toBeTruthy();
    expect(backend.postsTo('/open')).toHaveLength(1);
    const body = backend.postsTo('/open')[0].body;
    expect(body).toMatchObject({ fuel_station_id: 'a', opening_float_minor: 50_000 });
    expect(String(body.idempotency_key)).toMatch(/^awj-ops-/);
    expect(backend.postsTo('/staff')[0].body).toEqual({ user_id: 'u1', role: 'attendant' });
    expect(await screen.findByText("You're on the shift.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Record the starting readings' }).getAttribute('href')).toBe('/fuel-stations/ops/shifts/new-1/readings/opening');
  });

  it('zero is a deliberate choice: the "No cash (0)" button fills it and the server receives 0', async () => {
    const user = userEvent.setup();
    connect(baseData());
    renderOps(<OpenShiftScreen />);
    await field('open-float');
    await user.click(buttonNamed('No cash (0)'));
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    await screen.findByText('Shift SH-NEW-1 is open');
    expect(backend.postsTo('/open')[0].body.opening_float_minor).toBe(0);
  });

  it('a double click on confirm sends ONE request', async () => {
    const user = userEvent.setup();
    connect(baseData());
    renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '10');
    await user.click(buttonNamed('Review and open the shift'));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' });
    await user.dblClick(confirm);
    await screen.findByText('Shift SH-NEW-1 is open');
    expect(backend.postsTo('/open')).toHaveLength(1);
  });

  it('rejects a malformed amount in the field before any request', async () => {
    const user = userEvent.setup();
    connect(baseData());
    renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '12.345');
    expect(await screen.findByText('Enter a valid amount in riyals, like 500 or 250.50.')).toBeTruthy();
    expect((buttonNamed('Review and open the shift') as HTMLButtonElement).disabled).toBe(true);
    expect(backend.posts).toHaveLength(0);
  });

  it('a lost reply is NOT shown as success; "Check status" finds the shift; a retry reuses the SAME idempotency key', async () => {
    const user = userEvent.setup();
    connect(baseData());
    backend.fail({ match: (c) => c.path.endsWith('/open'), mode: 'network_after_apply' });
    renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '500');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    expect(await screen.findByText(/The connection dropped after sending\. The action may have gone through\./)).toBeTruthy();
    expect(screen.queryByText('Shift SH-NEW-1 is open')).toBeNull();
    expect(backend.postsTo('/staff')).toHaveLength(0); // لا إسناد على نتيجة غير مؤكدة

    // إعادة بنفس الحمولة ⇒ نفس المفتاح ⇒ الخادم يعيد الوردية نفسها (لا وردية ثانية)
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    expect(await screen.findByText('Shift SH-NEW-1 is open')).toBeTruthy();
    const keys = backend.postsTo('/open').map((c) => c.body.idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(backend.openKeysUsed()).toHaveLength(1);
  });

  it('after a lost reply, "Check status" shows the already-open shift instead of inviting a second open', async () => {
    const user = userEvent.setup();
    connect(baseData());
    backend.fail({ match: (c) => c.path.endsWith('/open'), mode: 'server_error_after_apply' });
    renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '500');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    await screen.findByText(/The server hit an error after sending\./);
    await user.click(buttonNamed('Check status'));
    expect(await screen.findByText('A shift is already open')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the shift' }).getAttribute('href')).toBe('/fuel-stations/ops/shifts/new-1');
    expect(backend.postsTo('/open')).toHaveLength(1);
  });

  it('an offline attempt after a lost reply does NOT discard the intent key: the next online retry replays the SAME key (no second shift)', async () => {
    const user = userEvent.setup();
    connect(baseData());
    backend.fail({ match: (c) => c.path.endsWith('/open'), mode: 'network_after_apply' });
    renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '500');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    await screen.findByText(/The connection dropped after sending\./);

    setOnline(false);
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    await screen.findByText(/No internet connection\. Nothing was sent/);
    expect(backend.postsTo('/open')).toHaveLength(1);

    setOnline(true);
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    expect(await screen.findByText('Shift SH-NEW-1 is open')).toBeTruthy();
    const keys = backend.postsTo('/open').map((c) => c.body.idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(backend.openKeysUsed()).toHaveLength(1);
  });

  it('"Check status" finding the shift reconciles the uncertain intent: after that shift is closed, a new open uses a NEW key and works', async () => {
    const user = userEvent.setup();
    const data = baseData();
    connect(data);
    backend.fail({ match: (c) => c.path.endsWith('/open'), mode: 'server_error_after_apply' });
    const view = renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '500');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    await screen.findByText(/The server hit an error after sending\./);
    await user.click(buttonNamed('Check status'));
    await screen.findByText('A shift is already open');
    await waitFor(() => expect(Object.keys(sessionStorage).filter((k) => k.startsWith('awj:fuel-ops:intent:'))).toEqual([]));

    backend.detail('new-1').status = 'closed'; // أُغلقت لاحقاً
    for (const row of data.shifts) if (row.id === 'new-1') row.status = 'closed';
    view.unmount();
    renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '500');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    expect(await screen.findByText('Shift SH-NEW-2 is open')).toBeTruthy();
    const keys = backend.postsTo('/open').map((c) => c.body.idempotency_key);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('a replay that returns an old CLOSED shift is not success and frees the key, so the next confirmation is a fresh intent', async () => {
    const user = userEvent.setup();
    connect(baseData());
    backend.fail({ match: (c) => c.path.endsWith('/open'), mode: 'network_after_apply' });
    renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '500');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    await screen.findByText(/The connection dropped after sending\./);
    backend.detail('new-1').status = 'closed'; // التزمت ثم أُغلقت قبل إعادة المحاولة
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    await screen.findByText(/we can't confirm the action went through/);
    expect(screen.queryByText(/is open$/)).toBeNull();
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    expect(await screen.findByText('Shift SH-NEW-2 is open')).toBeTruthy();
  });

  it('a different amount is a NEW intent ⇒ a NEW key (the server would otherwise replay the first effect)', async () => {
    const user = userEvent.setup();
    connect(baseData());
    backend.fail({ match: (c) => c.path.endsWith('/open'), mode: 'network_before_apply' });
    renderOps(<OpenShiftScreen />);
    const input = await field('open-float');
    await user.type(input, '500');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    await screen.findByText(/The connection dropped/);
    await user.clear(input);
    await user.type(input, '600');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    await screen.findByText('Shift SH-NEW-1 is open');
    const [first, second] = backend.postsTo('/open');
    expect(first.body.idempotency_key).not.toBe(second.body.idempotency_key);
    expect(second.body.opening_float_minor).toBe(60_000);
  });

  it('a server rejection is shown plainly and nothing is announced as opened', async () => {
    const user = userEvent.setup();
    connect(baseData());
    backend.fail({ match: (c) => c.path.endsWith('/open'), mode: 'reject', status: 422, message: 'توجد وردية وقود مفتوحة للمحطة؛ يجب إغلاقها أو تصحيحها عبر المسار المدقق أولاً.' });
    renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '500');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    expect(await screen.findByText('This station already has an open shift. Open it instead of creating a second one.')).toBeTruthy();
    expect(screen.queryByText(/is open$/)).toBeNull();
    expect(backend.postsTo('/staff')).toHaveLength(0);
  });

  it('a reply that does not match what was sent is NOT trusted', async () => {
    const user = userEvent.setup();
    connect(baseData());
    const real = apiMock.getMockImplementation() as (path: string, init?: unknown) => Promise<unknown>;
    apiMock.mockImplementation(async (path: string, init?: unknown) => (path.endsWith('/open') ? { data: shiftDetail('x', 'a', { status: 'open', opening_float_minor: 1 }) } : real(path, init)) as never);
    renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '500');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    expect(await screen.findByText(/we can't confirm the action went through/)).toBeTruthy();
    expect(screen.queryByText(/is open$/)).toBeNull();
  });

  it('staff assignment failing after a good open is its own state with its own retry ("already on the shift" counts as done)', async () => {
    const user = userEvent.setup();
    connect(baseData());
    backend.fail({ match: (c) => c.path.endsWith('/staff'), mode: 'reject', status: 422, message: 'العامل لا يملك نطاق الوصول لفرع الشفت.' });
    renderOps(<OpenShiftScreen />);
    await user.type(await field('open-float'), '500');
    await user.click(buttonNamed('Review and open the shift'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and open the shift' }));
    expect(await screen.findByText('The shift opened, but we couldn\'t add you to it.')).toBeTruthy();
    await user.click(buttonNamed('Add me to the shift again'));
    expect(await screen.findByText("You're on the shift.")).toBeTruthy();
    expect(backend.postsTo('/staff')).toHaveLength(2);
  });

  it('an existing open shift is shown instead of the form; a user without the permission sees why', async () => {
    connect(withShift());
    renderOps(<OpenShiftScreen />);
    expect(await screen.findByText('A shift is already open')).toBeTruthy();
    expect(screen.queryByTestId('open-float')).toBeNull();
    cleanup();

    seedUser(['fuel_stations.view', 'fuel.shift.view']);
    connect(baseData());
    renderOps(<OpenShiftScreen />);
    expect(await screen.findByText("You can't open shifts")).toBeTruthy();
    expect(backend.posts).toHaveLength(0);
  });

  it('works in Arabic/RTL with Latin digits and has no accessibility violations', async () => {
    connect(baseData());
    const { container } = renderOps(<OpenShiftScreen />, 'ar');
    await field('open-float');
    expect(screen.getByText('عهدة الافتتاح (النقد في الدرج الآن)')).toBeTruthy();
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

/* ───────────────────────────── إدخال القراءات ───────────────────────────── */

describe('meter and tank readings entry', () => {
  const openScreen = (stage: 'opening' | 'closing' = 'opening', locale: 'en' | 'ar' = 'en') => renderOps(<ReadingsEntryScreen shiftId="s1" stage={stage} />, locale);

  it('lists the station\'s real pumps → nozzles and tanks, reviews, then saves each reading ONCE with a deterministic evidence key and integer mL', async () => {
    const user = userEvent.setup();
    connect(withShift());
    openScreen();
    expect(await screen.findByText('Pump 1 · Nozzle 1')).toBeTruthy();
    expect(screen.getByText('Pump 2 · Nozzle 2')).toBeTruthy();
    expect(screen.getByText('Tank t1')).toBeTruthy();
    await user.type(await field('entry-m:n1'), '125430.5');
    await user.type(await field('entry-m:n2'), '98765');
    await user.type(await field('entry-t:t1'), '21480.5');
    await user.type(await field('entry-t:t2'), '15200');
    await user.click(buttonNamed('Review and save (4)'));
    expect(backend.posts).toHaveLength(0);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("A reading can't be changed after it is saved. Check every number.")).toBeTruthy();
    expect(within(dialog).getByText('125,430.500')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));

    expect(await screen.findByText('Starting readings complete')).toBeTruthy();
    const meters = backend.postsTo('/meter-readings').map((c) => c.body);
    expect(meters).toEqual([
      { fuel_nozzle_id: 'n1', reading_stage: 'opening', meter_milliliters: 125_430_500, evidence_key: 'awj-ops:m:s1:n1:opening' },
      { fuel_nozzle_id: 'n2', reading_stage: 'opening', meter_milliliters: 98_765_000, evidence_key: 'awj-ops:m:s1:n2:opening' },
    ]);
    expect(backend.postsTo('/tank-readings').map((c) => c.body)).toEqual([
      { fuel_tank_id: 't1', reading_stage: 'opening', reading_type: 'physical', quantity_milliliters: 21_480_500, evidence_key: 'awj-ops:t:s1:t1:opening' },
      { fuel_tank_id: 't2', reading_stage: 'opening', reading_type: 'physical', quantity_milliliters: 15_200_000, evidence_key: 'awj-ops:t:s1:t2:opening' },
    ]);
    for (const call of backend.posts) expect(JSON.stringify(call.body)).not.toMatch(/measured_at|recorded_at/); // ساعة الخادم وحدها
    expect(screen.getByRole('link', { name: 'Back to the shift' }).getAttribute('href')).toBe('/fuel-stations/ops/shifts/s1');
  });

  it('HARD-BLOCKS an ending reading below the starting one — nothing is sent', async () => {
    const user = userEvent.setup();
    connect(withShift({ meter_readings: [meter('o1', 'n1', 'opening', 100_000), meter('o2', 'n2', 'opening', 100_000)] }));
    openScreen('closing');
    await user.type(await field('entry-m:n1'), '99');
    expect(await screen.findByText(/The ending reading is lower than the starting reading \(100\.000\)/)).toBeTruthy();
    expect((buttonNamed(/Review and save/) as HTMLButtonElement).disabled).toBe(true);
    expect(backend.posts).toHaveLength(0);
    // تصحيح الرقم يفتح الزر ويعرض الكمية المحسوبة
    await user.clear(await field('entry-m:n1'));
    await user.type(await field('entry-m:n1'), '150.25');
    expect(await screen.findByText(/Quantity: 50\.250 L/)).toBeTruthy();
    expect((buttonNamed(/Review and save \(1\)/) as HTMLButtonElement).disabled).toBe(false);
  });

  it('an ending reading needs the starting one first (and points to where to record it)', async () => {
    connect(withShift({ meter_readings: [meter('o1', 'n1', 'opening', 100_000)] }));
    openScreen('closing');
    expect(await screen.findByText("Record this nozzle's starting reading first.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to starting readings' }).getAttribute('href')).toBe('/fuel-stations/ops/shifts/s1/readings/opening');
    expect(screen.queryByTestId('entry-m:n2')).toBeNull();
    expect(await field('entry-m:n1')).toBeTruthy();
  });

  it('opening readings optional by policy: ending readings can be entered and saved without them', async () => {
    const user = userEvent.setup();
    const data = withShift();
    data.settings = { a: { shift_opening_meter_reading_required: false, shift_closing_meter_reading_required: true, shift_opening_tank_reading_required: false, shift_closing_tank_reading_required: false, shift_opening_cash_float_required: true, shift_mandatory_staff_assignment: false } };
    connect(data);
    openScreen('closing');
    await user.type(await field('entry-m:n1'), '150');
    expect(screen.queryByText("Record this nozzle's starting reading first.")).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Review and save (1)' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(backend.postsTo('/meter-readings')).toHaveLength(1));
    expect(backend.postsTo('/meter-readings')[0].body).toMatchObject({ reading_stage: 'closing', meter_milliliters: 150_000 });
  });

  it('opening optional by policy: a starting reading above an already-saved ending reading is blocked before any request', async () => {
    const user = userEvent.setup();
    const data = withShift({ meter_readings: [meter('c1', 'n1', 'closing', 100_000)] });
    data.settings = { a: { shift_opening_meter_reading_required: false, shift_closing_meter_reading_required: true, shift_opening_tank_reading_required: false, shift_closing_tank_reading_required: false, shift_opening_cash_float_required: true, shift_mandatory_staff_assignment: false } };
    connect(data);
    openScreen('opening');
    await user.type(await field('entry-m:n1'), '150');
    expect(await screen.findByText(/higher than the ending reading already recorded \(100\.000\)/)).toBeTruthy();
    expect((buttonNamed(/Review and save/) as HTMLButtonElement).disabled).toBe(true);
    expect(backend.posts).toHaveLength(0);
  });

  it('a starting tank reading inherits the type of an already-saved ending reading (atg), so the pair never mismatches', async () => {
    const user = userEvent.setup();
    connect(withShift({ tank_readings: [tankReading('tc', 't1', 'closing', 500_000, { reading_type: 'atg' })] }));
    openScreen('opening');
    await user.type(await field('entry-t:t1'), '600');
    await user.click(await screen.findByRole('button', { name: 'Review and save (1)' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(backend.postsTo('/tank-readings')).toHaveLength(1));
    expect(backend.postsTo('/tank-readings')[0].body).toMatchObject({ reading_stage: 'opening', reading_type: 'atg' });
  });

  it('keeps going after one rejection: saved rows lock, the failed row stays editable with the server\'s reason', async () => {
    const user = userEvent.setup();
    connect(withShift());
    backend.fail({ match: (c) => c.path.endsWith('/meter-readings') && c.body.fuel_nozzle_id === 'n1', mode: 'reject', status: 422, message: 'قراءة العداد لهذه الفوهة والمرحلة مسجلة بالفعل ولا يعاد استخدامها.' });
    openScreen();
    await user.type(await field('entry-m:n1'), '10');
    await user.type(await field('entry-m:n2'), '20');
    await user.click(buttonNamed('Review and save (2)'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }));
    expect(await screen.findByText('This reading is already recorded and can\'t be changed. Refresh the page.')).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('[data-row-state="saved"]')).toHaveLength(1));
    expect(((await field('entry-m:n1')) as HTMLInputElement).value).toBe('10'); // ما زال قابلاً للتعديل
    expect(backend.postsTo('/meter-readings')).toHaveLength(2);
  });

  it('a lost reply stops the batch, is labelled unconfirmed, and "Check status" finds what the server actually saved — no blind re-send', async () => {
    const user = userEvent.setup();
    connect(withShift());
    backend.fail({ match: (c) => c.path.endsWith('/meter-readings') && c.body.fuel_nozzle_id === 'n1', mode: 'network_after_apply' });
    openScreen();
    await user.type(await field('entry-m:n1'), '10');
    await user.type(await field('entry-m:n2'), '20');
    await user.click(buttonNamed('Review and save (2)'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }));
    expect(await screen.findByText(/The connection dropped after sending\./)).toBeTruthy();
    expect(backend.postsTo('/meter-readings')).toHaveLength(1); // التوقف عند أول غير مؤكد
    await user.click(buttonNamed('Check status'));
    await waitFor(() => expect(document.querySelectorAll('[data-row-state="saved"]')).toHaveLength(1)); // n1 محفوظة فعلاً في الخادم
    // المتبقي يُحفظ بمراجعة جديدة؛ n1 لا يُرسَل ثانيةً
    await user.click(buttonNamed('Review and save (1)'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(backend.postsTo('/meter-readings')).toHaveLength(2));
    expect(backend.postsTo('/meter-readings').map((c) => c.body.fuel_nozzle_id)).toEqual(['n1', 'n2']);
  });

  it('an offline save says nothing was sent (no silent return to the unchanged form)', async () => {
    const user = userEvent.setup();
    connect(withShift());
    openScreen();
    await user.type(await field('entry-m:n1'), '10');
    await user.click(buttonNamed('Review and save (1)'));
    const dialog = await screen.findByRole('dialog');
    setOnline(false);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and save' }));
    expect(await screen.findByText(/No internet connection\. Nothing was sent/)).toBeTruthy();
    expect(backend.postsTo('/meter-readings')).toHaveLength(0);
    expect(((await field('entry-m:n1')) as HTMLInputElement).value).toBe('10'); // ما كتبه المستخدم باقٍ
  });

  it('an opening reading that differs from the last recorded ending is a WARNING that needs an acknowledgement, never a block', async () => {
    const user = userEvent.setup();
    const data = withShift();
    data.shifts.push(makeShift('prev', 'a', { number: 'SH-000', status: 'approved', opened_at: '2026-11-03T05:00:00+00:00' }));
    data.details!.prev = shiftDetail('prev', 'a', { number: 'SH-000', status: 'approved', opened_at: '2026-11-03T05:00:00+00:00', meter_readings: [meter('pc1', 'n1', 'closing', 50_000)] });
    connect(data);
    openScreen();
    expect(await screen.findByText('Last recorded ending: 50.000 (shift SH-000)')).toBeTruthy();
    await user.type(await field('entry-m:n1'), '60');
    expect(await screen.findByText('Differs from the last recorded ending (50.000). Make sure it\'s what the meter shows now.')).toBeTruthy();
    await user.click(buttonNamed('Review and save (1)'));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm and save' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(within(dialog).getByRole('checkbox'));
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() => expect(backend.postsTo('/meter-readings')).toHaveLength(1));
  });

  it('an unsaved draft survives a reload on this device only, and is wiped once the server confirms', async () => {
    const user = userEvent.setup();
    connect(withShift());
    const first = openScreen();
    await user.type(await field('entry-m:n1'), '123.5');
    expect(screen.getByText('What you typed is kept temporarily on this device only and hasn\'t been saved to the system yet.')).toBeTruthy();
    first.unmount();
    openScreen();
    expect(((await field('entry-m:n1')) as HTMLInputElement).value).toBe('123.5');
    await user.click(buttonNamed('Review and save (1)'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(backend.postsTo('/meter-readings')).toHaveLength(1));
    await waitFor(() => expect(Object.keys(sessionStorage).filter((key) => key.startsWith('awj:fuel-ops:draft:'))).toEqual([]));
  });

  it('accepts Arabic-Indic digits and sends Latin integers', async () => {
    const user = userEvent.setup();
    connect(withShift());
    openScreen('opening', 'ar');
    await user.type(await field('entry-m:n1'), '٥٠٠٫٥');
    await user.click(await screen.findByRole('button', { name: /مراجعة وحفظ \(1\)/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'تأكيد وحفظ' }));
    await waitFor(() => expect(backend.postsTo('/meter-readings')).toHaveLength(1));
    expect(backend.postsTo('/meter-readings')[0].body.meter_milliliters).toBe(500_500);
  });

  it('a shift that is not open takes no readings; a viewer without the permission cannot enter any', async () => {
    connect(withShift({ status: 'closed' }));
    openScreen();
    expect(await screen.findByText("The shift isn't open")).toBeTruthy();
    cleanup();
    seedUser(['fuel_stations.view', 'fuel.shift.view']);
    connect(withShift());
    openScreen();
    expect(await screen.findByText("You can't open shifts")).toBeTruthy();
    expect(backend.posts).toHaveLength(0);
  });

  it('optional tank readings stay saveable even when every required meter reading is already saved', async () => {
    const user = userEvent.setup();
    const data = withShift({ meter_readings: [meter('o1', 'n1', 'opening', 100_000), meter('o2', 'n2', 'opening', 100_000)] });
    data.settings = { a: { shift_opening_meter_reading_required: true, shift_closing_meter_reading_required: true, shift_opening_tank_reading_required: false, shift_closing_tank_reading_required: false, shift_opening_cash_float_required: true, shift_mandatory_staff_assignment: false } };
    connect(data);
    openScreen();
    expect(await screen.findByText('Starting readings complete')).toBeTruthy();
    await user.type(await field('entry-t:t1'), '21480');
    await user.click(await screen.findByRole('button', { name: 'Review and save (1)' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(backend.postsTo('/tank-readings')).toHaveLength(1));
  });

  it('a failed assets request shows an error with a retry instead of an endless skeleton', async () => {
    const user = userEvent.setup();
    connect(withShift());
    backend.base.fail((url) => url.startsWith('/fuel-stations/nozzles'), new ApiError(500, 'x', {}));
    openScreen();
    expect(await screen.findByText("Couldn't load data")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByTestId('entry-m:n1')).toBeNull();
    void user;
  });

  it('an unknown stage in the URL is a not-found, not an entry form', async () => {
    connect(withShift());
    renderOps(<ReadingsEntryScreen shiftId="s1" stage="sideways" />);
    expect((await screen.findAllByText("Shift not available")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('entry-m:n1')).toBeNull();
  });

  it('has no accessibility violations and uses ≥16px numeric inputs with a decimal keypad', async () => {
    connect(withShift());
    const { container } = openScreen();
    const input = await field('entry-m:n1');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('dir')).toBe('ltr');
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

/* ───────────────────────────── التسليم والنقد ───────────────────────────── */

describe('handover — cash count and closing', () => {
  const openScreen = (locale: 'en' | 'ar' = 'en') => renderOps(<HandoverScreen shiftId="s1" />, locale);
  const confirmClose = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(buttonNamed('Review and hand over the shift'));
    const dialog = await screen.findByRole('dialog');
    const cta = within(dialog).getByRole('button', { name: 'Confirm handover' }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true); // يلزم إقرار صريح
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(cta);
  };

  it('#2021: when the server basis includes sale receipts, no local expected/variance is shown or enforced — the server decides', async () => {
    const user = userEvent.setup();
    connect(withShift({ ...allReadings(), cash_summary: {
      state: 'live', basis: 'receiving_shift_receipts',
      components: { opening_float_minor: 50_000, official_cash_receipts: { available: true, amount_minor: 100_000, count: 2, reason: null }, cash_in_minor: 0, cash_out_minor: 0, treasury_handover_minor: 0, expenses_minor: 0 },
      expected_cash_minor: 150_000, expected_cash_partial_minor: 150_000, expected_complete: true, incompleteness: [],
      counted_cash_minor: null, variance_minor: null, variance_final: false,
      network_receipts: { available: false, amount_minor: null, reason: 'basis_not_enabled', information_only: true },
      unattributed_cash_receipts: { count: 0, amount_minor: 0 },
      post_close_adjustments: { available: true, items: [], net_effect_minor: 0 },
    } }));
    openScreen();
    expect(await screen.findByText('Every required reading is recorded.')).toBeTruthy();
    expect(document.querySelector('[data-expected]')?.textContent).not.toContain('500.00');
    expect(screen.queryByText(/does not include fuel-sale cash|not include fuel/i)).toBeNull();
    await user.type(await field('counted-cash'), '480');
    const preview = document.querySelector('[data-variance-preview]') as HTMLElement;
    expect(preview.textContent).not.toContain('Shortage'); // لا فرق محلي مخترع
    expect((buttonNamed('Review and hand over the shift') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a complete shift: counted cash → preview → protected confirmation → closes with exactly the counted amount (no key, no sales, no approval)', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()));
    openScreen();
    expect(await screen.findByText('Every required reading is recorded.')).toBeTruthy();
    expect((buttonNamed('Review and hand over the shift') as HTMLButtonElement).disabled).toBe(true); // لا عدّ بعد
    expect(document.querySelector('[data-expected]')?.textContent).toContain('500.00');
    await user.type(await field('counted-cash'), '480');
    const preview = document.querySelector('[data-variance-preview]') as HTMLElement;
    expect(preview.textContent).toContain('Shortage');
    expect(preview.textContent).toContain('20.00');
    expect(screen.getByText('The difference is saved for the supervisor to review and is not settled automatically.')).toBeTruthy();
    await confirmClose(user);

    expect(await screen.findByText('Shift handed over')).toBeTruthy();
    expect(backend.postsTo('/close')).toHaveLength(1);
    expect(backend.postsTo('/close')[0].body).toEqual({ counted_cash_minor: 48_000 });
    expect(screen.getByText('The shift is now waiting for supervisor approval.')).toBeTruthy();
    expect(backend.detail('s1').status).toBe('closed');
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/fuel-stations/ops');
  });

  it('shows the network/cards box as unavailable instead of faking a reconciliation', async () => {
    connect(withShift(allReadings()));
    openScreen();
    await screen.findByText('Every required reading is recorded.');
    const box = document.querySelector('[data-network-blocked]') as HTMLElement;
    expect(box.textContent).toContain('Not available right now');
    expect(box.querySelector('input')).toBeNull();
  });

  it('missing readings block the handover and link to where they are recorded', async () => {
    connect(withShift({ meter_readings: [meter('o1', 'n1', 'opening', 1)] }));
    const user = userEvent.setup();
    openScreen();
    await screen.findByText('Starting meters');
    await user.type(await field('counted-cash'), '500');
    expect((buttonNamed('Review and hand over the shift') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Record the required readings first.')).toBeTruthy();
    const fix = screen.getAllByRole('link', { name: 'Record now' }).map((a) => a.getAttribute('href'));
    expect(fix).toContain('/fuel-stations/ops/shifts/s1/readings/opening');
    expect(fix).toContain('/fuel-stations/ops/shifts/s1/readings/closing');
    expect(backend.posts).toHaveLength(0);
  });

  it('a pair with ending < starting blocks the handover (the server would refuse to close)', async () => {
    const user = userEvent.setup();
    const bad = allReadings();
    bad.meter_readings = bad.meter_readings!.map((r) => (r.id === 'c0' ? { ...r, meter_milliliters: 1 } : r));
    connect(withShift(bad));
    openScreen();
    expect(await screen.findByText(/Nozzles whose ending reading is below the start: 1/)).toBeTruthy();
    await user.type(await field('counted-cash'), '500');
    expect((buttonNamed('Review and hand over the shift') as HTMLButtonElement).disabled).toBe(true);
  });

  it('an empty field is not zero: a count must be typed; zero is allowed when typed', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()));
    openScreen();
    const input = await field('counted-cash');
    expect((buttonNamed('Review and hand over the shift') as HTMLButtonElement).disabled).toBe(true);
    await user.type(input, '0');
    expect((buttonNamed('Review and hand over the shift') as HTMLButtonElement).disabled).toBe(false);
    await user.clear(input);
    await user.type(input, '12.345');
    expect(await screen.findByText(/Enter a valid amount in riyals/)).toBeTruthy();
  });

  it('a lost reply on close is never re-sent blindly; "Check status" reads the shift and shows it handed over', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()));
    backend.fail({ match: (c) => c.path.endsWith('/close'), mode: 'network_after_apply' });
    openScreen();
    await user.type(await field('counted-cash'), '500');
    await confirmClose(user);
    expect(await screen.findByText(/The connection dropped after sending\. The action may have gone through\./)).toBeTruthy();
    expect(screen.queryByText('Shift handed over')).toBeNull();
    await user.click(buttonNamed('Check status'));
    expect(await screen.findByText('This shift has been handed over')).toBeTruthy();
    expect(backend.postsTo('/close')).toHaveLength(1);
  });

  it('the server\'s policy refusal is shown in plain words and the shift stays open', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()));
    backend.fail({ match: (c) => c.path.endsWith('/close'), mode: 'reject', status: 422, message: 'سياسة المحطة تتطلب إسناد عامل واحد على الأقل قبل إغلاق الشفت.' });
    openScreen();
    await user.type(await field('counted-cash'), '500');
    await confirmClose(user);
    expect(await screen.findByText('You can\'t hand over before at least one person is on the shift.')).toBeTruthy();
    expect(backend.detail('s1').status).toBe('open');
  });

  it('when the station policy forbids closing with a cash difference, a mismatch disables the handover and says why', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()), { policy: { shift_allow_close_with_pending_cash_variance: false } });
    openScreen();
    await user.type(await field('counted-cash'), '499');
    expect(await screen.findByText('Station policy blocks handover while there is a cash difference.')).toBeTruthy();
    expect((buttonNamed('Review and hand over the shift') as HTMLButtonElement).disabled).toBe(true);
    await user.clear(await field('counted-cash'));
    await user.type(await field('counted-cash'), '500');
    expect((buttonNamed('Review and hand over the shift') as HTMLButtonElement).disabled).toBe(false);
  });

  it('records a cash movement with a persistent idempotency key; the list and the expected cash update from the server\'s reply', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()));
    openScreen();
    await screen.findByText('No cash entries in this shift.');
    await user.click(document.querySelector('[data-open-movement]') as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('Take cash out'));
    await user.type(within(dialog).getByTestId('movement-amount'), '10');
    await user.type(within(dialog).getByLabelText('Reason'), 'Change for the drawer');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and record' }));
    expect(await screen.findByText('Cash entry recorded.')).toBeTruthy();
    const call = backend.postsTo('/cash-movements')[0].body;
    expect(call).toMatchObject({ type: 'cash_out', amount_minor: 1_000, reason: 'Change for the drawer' });
    expect(String(call.idempotency_key)).toMatch(/^awj-ops-/);
    await waitFor(() => expect(document.querySelector('[data-expected]')?.textContent).toContain('490.00'));
    expect(document.querySelector('[data-movements]')?.textContent).toContain('Change for the drawer');
  });

  it('a confirmed cash entry is shown from the write reply even if the follow-up shift read fails (no stale balance next to a "saved" banner)', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()));
    openScreen();
    await screen.findByText('No cash entries in this shift.');
    backend.base.fail((url) => url === '/fuel-stations/shifts/s1', new ApiError(500, 'x', {}));
    await user.click(await screen.findByRole('button', { name: 'Record a cash entry' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('Take cash out'));
    await user.type(within(dialog).getByTestId('movement-amount'), '10');
    await user.type(within(dialog).getByLabelText('Reason'), 'Change for the drawer');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and record' }));
    expect(await screen.findByText('Cash entry recorded.')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-expected]')?.textContent).toContain('490.00'));
    expect(document.querySelector('[data-movements]')?.textContent).toContain('Change for the drawer');
  });

  it('blocks a withdrawal above the expected cash before any request, and a too-short reason', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()));
    openScreen();
    await user.click(await screen.findByRole('button', { name: 'Record a cash entry' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByLabelText('Take cash out'));
    await user.type(within(dialog).getByTestId('movement-amount'), '500.01');
    expect(await within(dialog).findByText(/The amount is more than the expected cash in the drawer/)).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Reason'), 'ab');
    expect((within(dialog).getByRole('button', { name: 'Confirm and record' }) as HTMLButtonElement).disabled).toBe(true);
    expect(backend.posts).toHaveLength(0);
  });

  it('the cash intent is persisted as UNCERTAIN before the request is dispatched (a tab closed mid-flight must not lose the key to the TTL)', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()));
    const real = apiMock.getMockImplementation() as (path: string, init?: unknown) => Promise<unknown>;
    apiMock.mockImplementation(async (path: string, init?: unknown) => (path.endsWith('/cash-movements') ? new Promise(() => {}) : real(path, init)) as never);
    openScreen();
    await user.click(await screen.findByRole('button', { name: 'Record a cash entry' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByTestId('movement-amount'), '25');
    await user.type(within(dialog).getByLabelText('Reason'), 'Float top-up');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and record' }));
    await waitFor(() => {
      const raw = Object.entries(sessionStorage).find(([k]) => k.startsWith('awj:fuel-ops:intent:') && k.endsWith(':cash'))?.[1];
      expect(raw && JSON.parse(raw).uncertain).toBe(true);
    });
  });

  it('a lost reply on a cash entry is retried with the SAME key — exactly one entry exists', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()));
    backend.fail({ match: (c) => c.path.endsWith('/cash-movements'), mode: 'network_after_apply' });
    openScreen();
    await user.click(await screen.findByRole('button', { name: 'Record a cash entry' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByTestId('movement-amount'), '25');
    await user.type(within(dialog).getByLabelText('Reason'), 'Float top-up');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and record' }));
    await within(dialog).findByText(/The connection dropped after sending\./);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and record' }));
    expect(await screen.findByText('Cash entry recorded.')).toBeTruthy();
    const keys = backend.postsTo('/cash-movements').map((c) => c.body.idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(backend.detail('s1').cash_movements).toHaveLength(1);
  });

  it('an offline attempt after a lost reply keeps the cash-entry key: the retry replays the SAME key and exactly one entry exists', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()));
    backend.fail({ match: (c) => c.path.endsWith('/cash-movements'), mode: 'network_after_apply' });
    openScreen();
    await user.click(await screen.findByRole('button', { name: 'Record a cash entry' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByTestId('movement-amount'), '25');
    await user.type(within(dialog).getByLabelText('Reason'), 'Float top-up');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and record' }));
    await within(dialog).findByText(/The connection dropped after sending\./);

    setOnline(false);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and record' }));
    await within(dialog).findByText(/No internet connection\. Nothing was sent/);
    setOnline(true);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm and record' }));
    expect(await screen.findByText('Cash entry recorded.')).toBeTruthy();
    const keys = backend.postsTo('/cash-movements').map((c) => c.body.idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(backend.detail('s1').cash_movements).toHaveLength(1);
  });

  it('a failed assets request shows an error with a retry instead of an endless skeleton', async () => {
    connect(withShift(allReadings()));
    backend.base.fail((url) => url.startsWith('/fuel-stations/nozzles'), new ApiError(500, 'x', {}));
    openScreen();
    expect(await screen.findByText("Couldn't load data")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('can register the user on the shift when the policy needs staff and nobody is on it', async () => {
    const user = userEvent.setup();
    connect(withShift({ ...allReadings(), staff_assignments: [] }), { policy: { shift_mandatory_staff_assignment: true } });
    openScreen();
    expect(await screen.findByText('No one is recorded on the shift.')).toBeTruthy();
    expect((buttonNamed('Review and hand over the shift') as HTMLButtonElement).disabled).toBe(true);
    await user.click(buttonNamed('Add me to the shift again'));
    await waitFor(() => expect(screen.queryByText('No one is recorded on the shift.')).toBeNull());
    expect(backend.postsTo('/staff')[0].body).toEqual({ user_id: 'u1', role: 'attendant' });
  });

  it('needs BOTH close and cash-count rights; others see a plain explanation', async () => {
    seedUser(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.close']);
    connect(withShift(allReadings()));
    openScreen();
    expect(await screen.findByText(/You don't have access|permission/i)).toBeTruthy();
    expect(backend.posts).toHaveLength(0);
  });

  it('has no accessibility violations in Arabic/RTL', async () => {
    connect(withShift(allReadings()));
    const { container } = openScreen('ar');
    await field('counted-cash');
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
