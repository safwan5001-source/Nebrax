// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/receiving', replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }) }));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import { product, station, tank } from '../__fixtures__';
import type { Station } from '../schemas';
import { StationOpsShell } from '../shell';
import { connectReceiving, type ReceivingWorld } from './__receiving-backend';
import { ReceivingDetailScreen } from './receiving-detail-screen';
import { ReceivingListScreen } from './receiving-list-screen';
import { ReceivingNewScreen } from './receiving-new-screen';

const apiMock = vi.mocked(api);
const VIEWER = 'u-viewer';
const ST = 'a';
const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const SUPERVISOR = ['fuel_stations.view', 'fuel.delivery.view', 'fuel.delivery.create', 'fuel.reading.record'];
const CREATOR = [...SUPERVISOR, 'products.view_cost'];
const APPROVER = ['fuel_stations.view', 'fuel.delivery.view', 'fuel.delivery.approve'];
const SELLER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open'];

function seedUser(permissions: string[], id = VIEWER): void {
  const user: AuthUser = { id, name: 'Sup Visor', email: 'sup@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

function build(over: Partial<ReceivingWorld> = {}): ReceivingWorld {
  const withWarehouse = { ...station(ST, { name: 'Station A' }), warehouse_id: 'wh1', warehouse: { id: 'wh1', name: 'Main Warehouse', code: 'WH' } } as unknown as Station;
  return {
    data: { stations: [withWarehouse], products: [product('p1', 'Alpha')], pumps: [], nozzles: [], tanks: [tank('t1', ST, 'p1', { name: 'Tank One' }), tank('t2', ST, 'p1', { name: 'Tank Two', status: 'inactive' })], prices: [], shifts: [] },
    deliveries: [], suppliers: [{ id: 'sup1', name: 'Acme Oil', code: 'S-1' }, { id: 'sup2', name: 'Beta Fuel', code: 'S-2' }],
    readings: [], posts: [], gets: [], viewerId: VIEWER, canSeeCost: true, distinctApprover: false, ...over,
  };
}

const draft = (over: Record<string, unknown> = {}) => ({
  id: UID(1), status: 'draft', station_id: ST, tank_id: 't1', fuel_product_id: 'p1', warehouse_id: 'wh1', supplier_id: 'sup1', purchase_reference: 'PO-9', delivery_note_number: 'DN-9',
  dispatched_milliliters: 1_000_000, received_milliliters: 995_500, transit_variance_milliliters: -4_500, received_total_cost_minor: 500_000, stock_movement_id: null,
  received_at: '2026-11-06T08:30:00+00:00', approved_at: null, approved_by: null, notes: null, created_at: '2026-11-06T08:30:00+00:00', created_by: 'u-creator', tanker_identifier: 'TNK-1', driver_name: null,
  supplier: { id: 'sup1', name: 'Acme Oil', code: 'S-1' }, tank: { id: 't1', name: 'Tank One', code: 'T1' }, warehouse: { id: 'wh1', name: 'Main Warehouse', code: 'WH' },
  before_physical_reading_id: 'rd-b', after_physical_reading_id: 'rd-a', ...over,
});

let world: ReceivingWorld;
function connect(w: ReceivingWorld) { world = w; connectReceiving(w, apiMock as never); }

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear(); sessionStorage.clear(); apiMock.mockReset();
  nav.pathname = '/fuel-stations/ops/receiving';
});
afterEach(() => cleanup());

const renderOps = (ui: React.ReactElement, locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell>{ui}</StationOpsShell>, locale);
const deliveryCalls = () => apiMock.mock.calls.filter(([path]) => String(path).includes('/fuel-stations/deliveries') || String(path).includes('delivery-suppliers') || String(path).includes('/fuel-stations/readings'));
const writes = () => apiMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'POST');

async function fillWizard(user: ReturnType<typeof userEvent.setup>, opts: { readings?: boolean; note?: string } = {}) {
  await user.click(await screen.findByRole('radio', { name: /Acme Oil/ }));
  await user.click(await screen.findByRole('radio', { name: /Tank One/ }));
  await user.type(screen.getByLabelText('Supplier delivery note number'), opts.note ?? 'DN-100');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(await screen.findByLabelText('Dispatched quantity'), '1000');
  await user.type(screen.getByLabelText('Received quantity'), '995.5');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  if (opts.readings !== false) {
    await user.type(await screen.findByLabelText('Before receiving'), '100');
    await user.type(screen.getByLabelText('After receiving'), '1095.5');
  } else {
    await screen.findByLabelText('Before receiving');
  }
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Photograph the supplier note', { selector: 'h2' }); // B5.1: خطوة المستند (اختيارية)
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Review', { selector: 'h2' });
}

describe('visibility follows real permissions', () => {
  it('a seller has no Receiving entry and the receiving screens send no receiving request', async () => {
    seedUser(SELLER);
    connect(build());
    renderOps(<ReceivingListScreen />);
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Receiving' })).toBeNull();
    expect(deliveryCalls()).toHaveLength(0);
  });

  it('a supervisor sees Receiving in the navigation and can start a receiving WITHOUT any cost permission (B5.1); no cost is shown to them', async () => {
    seedUser(SUPERVISOR);
    connect(build({ canSeeCost: false, deliveries: [draft() as never] }));
    renderOps(<ReceivingListScreen />);
    expect(await screen.findByText(/DN-9/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Receiving' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'New receiving' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Receivings awaiting cost' })).toBeNull(); // قائمة التكلفة لمن يرى التكلفة فقط
    expect(document.body.textContent).not.toMatch(/5,000|5000|SAR/); // لا تكلفة لمن لا يملك صلاحيتها
  });

  it('the new-receiving screen refuses (and sends nothing) without the create permission, and opens for a creator without cost', async () => {
    seedUser(['fuel_stations.view', 'fuel.delivery.view']);
    connect(build());
    renderOps(<ReceivingNewScreen />);
    expect(await screen.findByText('You cannot create receivings')).toBeTruthy();
    cleanup();
    seedUser(SUPERVISOR);
    renderOps(<ReceivingNewScreen />);
    expect(await screen.findByRole('radio', { name: /Acme Oil/ })).toBeTruthy(); // المشرف بلا تكلفة يبدأ الاستلام
    expect(screen.getByText('Step 1 of 5', { exact: false })).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });
});

describe('receiving list', () => {
  it('lists the station receivings with status, received quantity, variance and the cost only for the authorised', async () => {
    seedUser(CREATOR);
    connect(build({ deliveries: [draft() as never, draft({ id: UID(2), status: 'approved', delivery_note_number: 'DN-8', approved_by: 'u-x' }) as never] }));
    renderOps(<ReceivingListScreen />);
    const row = (await screen.findByText(/DN-9/)).closest('li') as HTMLElement;
    expect(within(row).getByText('Draft')).toBeTruthy();
    expect(within(row).getByText(/995\.500/)).toBeTruthy();
    expect(within(row).getByText(/Short/)).toBeTruthy();
    expect(row.textContent).toMatch(/5,000\.00|5000\.00/);
    expect(screen.getByRole('link', { name: 'New receiving' }).getAttribute('href')).toBe('/fuel-stations/ops/receiving/new');
  });

  it('filters by status through the server and shows an honest empty state', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    connect(build({ deliveries: [draft() as never] }));
    renderOps(<ReceivingListScreen />);
    await screen.findByText(/DN-9/);
    await user.click(screen.getByRole('radio', { name: 'Approved' }));
    expect(await screen.findByText('No receivings')).toBeTruthy();
    expect(world.gets.some((url) => url.includes('status=approved') && url.includes('station_id=a'))).toBe(true);
  });
});

describe('creating a draft', () => {
  it('walks the five steps, records both readings then the draft (no cost anywhere), links the readings, and never approves or touches stock', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    connect(build());
    renderOps(<ReceivingNewScreen />);
    await fillWizard(user);

    const summary = screen.getByRole('heading', { name: 'Review' }).closest('section') as HTMLElement;
    expect(summary.textContent).toContain('Acme Oil');
    expect(summary.textContent).toContain('Tank One');
    expect(summary.textContent).toContain('Main Warehouse');
    expect(summary.textContent).toMatch(/Short/);
    expect(screen.getByText(/Saving only creates a draft/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText('Draft saved')).toBeTruthy();

    expect(world.posts.map((p) => p.path)).toEqual(['/fuel-stations/readings', '/fuel-stations/readings', '/fuel-stations/deliveries']);
    const [before, after, create] = world.posts;
    expect(before.body).toMatchObject({ fuel_station_id: 'a', fuel_tank_id: 't1', reading_type: 'physical', quantity_liters: '100' });
    expect(after.body).toMatchObject({ quantity_liters: '1095.5' });
    expect(String(before.body.evidence_key)).toMatch(/^awj-ops:rcv:awj-ops-.+:before:physical$/);
    expect(create.body).toMatchObject({
      fuel_station_id: 'a', fuel_tank_id: 't1', fuel_product_id: 'p1', warehouse_id: 'wh1', supplier_id: 'sup1', dispatched_liters: '1000', received_liters: '995.5',
      delivery_note_number: 'DN-100', before_physical_reading_id: 'rd-1', after_physical_reading_id: 'rd-2',
    });
    expect(String(create.body.idempotency_key)).toMatch(/^awj-ops-/);
    expect(create.body).not.toHaveProperty('received_at');
    expect(create.body).not.toHaveProperty('received_total_cost_minor'); // التكلفة NULL حتى تسجّلها المالية
    expect(screen.queryByLabelText('Receiving value')).toBeNull();
    expect(world.posts.some((p) => p.path.endsWith('/approve'))).toBe(false);
    expect(screen.getByRole('link', { name: 'Open the draft' }).getAttribute('href')).toMatch(/\/fuel-stations\/ops\/receiving\/0000/);
  });

  it('works without readings (only the draft is sent) and warns that nothing will be cross-checked', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    connect(build());
    renderOps(<ReceivingNewScreen />);
    await fillWizard(user, { readings: false });
    expect(screen.getByText(/No tank readings/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await screen.findByText('Draft saved');
    expect(world.posts.map((p) => p.path)).toEqual(['/fuel-stations/deliveries']);
  });

  it('blocks each step with a clear reason and keeps what was typed', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    connect(build());
    renderOps(<ReceivingNewScreen />);
    await screen.findByRole('radio', { name: /Acme Oil/ });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Choose the supplier.')).toBeTruthy();
    expect(screen.getByText('Choose the tank.')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: /Acme Oil/ }));
    await user.click(screen.getByRole('radio', { name: /Tank One/ }));
    await user.type(screen.getByLabelText('Supplier delivery note number'), 'DN-STEP');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(await screen.findByLabelText('Received quantity'), '0');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('The received quantity must be greater than zero.')).toBeTruthy();
    expect(screen.getByText('Enter the dispatched quantity.')).toBeTruthy();
    expect((screen.getByLabelText('Received quantity') as HTMLInputElement).value).toBe('0');
    expect(writes()).toHaveLength(0);
  });

  it('the supplier delivery note number is required at step one: blank or spaces block the step, the field says required, and nothing is sent', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    connect(build());
    renderOps(<ReceivingNewScreen />);
    await user.click(await screen.findByRole('radio', { name: /Acme Oil/ }));
    await user.click(await screen.findByRole('radio', { name: /Tank One/ }));
    const field = screen.getByLabelText('Supplier delivery note number') as HTMLInputElement;
    expect(field.getAttribute('aria-required')).toBe('true');
    await user.type(field, '   ');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Enter the supplier delivery note number (required).')).toBeTruthy();
    expect(screen.getByText('Step 1 of 5', { exact: false })).toBeTruthy(); // لم نتقدّم
    expect(writes()).toHaveLength(0);
    await user.clear(field);
    await user.type(field, 'DN-REQ-1');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByLabelText('Dispatched quantity')).toBeTruthy();
  });

  it('a server refusal for a missing note number (defence in depth) is explained and the draft is not created', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    connect(build({ beforePost: (post) => { if (post.path === '/fuel-stations/deliveries') throw new ApiError(422, 'FUEL_DELIVERY_NOTE_REQUIRED: رقم سند التسليم من المورد إلزامي لإنشاء استلام وقود جديد.', {}); } }));
    renderOps(<ReceivingNewScreen />);
    await fillWizard(user, { readings: false });
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText(/supplier delivery note number is required to create a new receiving/i)).toBeTruthy();
    expect(world.deliveries).toHaveLength(0);
  });

  it('refuses an after-reading below the before-reading before anything is sent', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    connect(build());
    renderOps(<ReceivingNewScreen />);
    await user.click(await screen.findByRole('radio', { name: /Acme Oil/ }));
    await user.click(await screen.findByRole('radio', { name: /Tank One/ }));
    await user.type(screen.getByLabelText('Supplier delivery note number'), 'DN-AFTER');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(await screen.findByLabelText('Dispatched quantity'), '10');
    await user.type(screen.getByLabelText('Received quantity'), '10');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(await screen.findByLabelText('Before receiving'), '500');
    await user.type(screen.getByLabelText('After receiving'), '400');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/lower than the before reading/)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('an inactive tank cannot be chosen', async () => {
    seedUser(CREATOR);
    connect(build());
    renderOps(<ReceivingNewScreen />);
    const inactive = (await screen.findByRole('radio', { name: /Tank Two/ })) as HTMLButtonElement;
    expect(inactive.disabled).toBe(true);
  });

  it('a double tap while the request is in flight sends one request set only', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    connect(build());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((async (path: string, init?: never) => {
      if ((init as { method?: string } | undefined)?.method === 'POST' && String(path) === '/fuel-stations/deliveries') await gate;
      return original(path, init as never);
    }) as never);
    renderOps(<ReceivingNewScreen />);
    await fillWizard(user);
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await user.click(await screen.findByRole('button', { name: 'Saving…' }));
    release();
    await screen.findByText('Draft saved');
    expect(world.posts.filter((p) => p.path === '/fuel-stations/deliveries')).toHaveLength(1);
    expect(world.posts.filter((p) => p.path === '/fuel-stations/readings')).toHaveLength(2);
  });

  it('a duplicate delivery note is refused by the server with a clear message and keeps the form (nothing duplicated)', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    connect(build({ deliveries: [draft({ delivery_note_number: 'DN-DUP', supplier_id: 'sup1', id: UID(7) }) as never] }));
    renderOps(<ReceivingNewScreen />);
    await fillWizard(user, { note: 'DN-DUP' });
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText(/already recorded for this supplier/)).toBeTruthy();
    expect(world.deliveries).toHaveLength(1);
    for (let i = 0; i < 4; i += 1) await user.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText('Supplier delivery note number') as HTMLInputElement).value).toBe('DN-DUP');
  });

  it('lost reply after saving: no automatic resend; checking the server finds the draft instead of creating another', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    connect(build({ dropReplyAfterApply: (post) => post.path === '/fuel-stations/deliveries' }));
    renderOps(<ReceivingNewScreen />);
    await fillWizard(user);
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText(/connection dropped after sending/i)).toBeTruthy();
    expect(world.posts.filter((p) => p.path === '/fuel-stations/deliveries')).toHaveLength(1);
    expect(world.deliveries).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText('Draft saved')).toBeTruthy();
    expect(world.posts.filter((p) => p.path === '/fuel-stations/deliveries')).toHaveLength(1); // لا إنشاء ثانٍ
  });

  it('lost reply when the server never saved it: the explicit retry reuses the SAME key (no duplicate even if it had)', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    let first = true;
    connect(build({ beforePost: (post) => { if (post.path === '/fuel-stations/deliveries' && first) { first = false; throw new TypeError('Failed to fetch'); } } }));
    renderOps(<ReceivingNewScreen />);
    await fillWizard(user);
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    await screen.findByText(/connection dropped after sending/i);
    await user.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText(/No matching draft was found/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Draft saved')).toBeTruthy();
    const keys = world.posts.filter((p) => p.path === '/fuel-stations/deliveries').map((p) => p.body.idempotency_key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    expect(world.posts.filter((p) => p.path === '/fuel-stations/readings')).toHaveLength(2); // القراءتان لم تتكرّرا
  });

  it('403/404/422/offline keep the entered data and say what happened', async () => {
    const user = userEvent.setup();
    seedUser(CREATOR);
    let mode: 'forbidden' | 'validation' = 'forbidden';
    connect(build({ beforePost: (post) => { if (post.path === '/fuel-stations/deliveries') throw mode === 'forbidden' ? new ApiError(403, 'ممنوع', {}) : new ApiError(422, 'الخزان أو منتج الوقود لا ينتمي إلى المحطة المحددة.', {}); } }));
    renderOps(<ReceivingNewScreen />);
    await fillWizard(user, { readings: false });
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText(/You are not allowed to do this/)).toBeTruthy();
    mode = 'validation';
    await user.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText(/does not belong to this station/)).toBeTruthy();
    // الرجوع للمراحل لا يفقد شيئاً.
    for (let i = 0; i < 3; i += 1) await user.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText('Received quantity') as HTMLInputElement).value).toBe('995.5');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    for (let i = 0; i < 3; i += 1) await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Save as draft|Try again/ }));
    expect(await screen.findByText(/No connection/)).toBeTruthy();
  });
});

describe('detail and approval', () => {
  const open = async (id = UID(1), locale: 'en' | 'ar' = 'en') => { renderOps(<ReceivingDetailScreen id={id} />, locale); await screen.findByText('Receiving details'); };

  it('shows the draft with names, quantities, variance, linked readings with the tank rise, and the cost only if authorised', async () => {
    seedUser([...APPROVER, 'products.view_cost']);
    connect(build({ deliveries: [draft() as never], readings: [{ id: 'rd-b', fuel_tank_id: 't1', reading_type: 'physical', quantity_milliliters: 100_000, evidence_key: 'k1', measured_at: '2026-11-06T07:00:00+00:00' }, { id: 'rd-a', fuel_tank_id: 't1', reading_type: 'physical', quantity_milliliters: 1_095_500, evidence_key: 'k2', measured_at: '2026-11-06T08:20:00+00:00' }] }));
    await open();
    expect(screen.getByText('Acme Oil', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('Main Warehouse')).toBeTruthy();
    expect(screen.getAllByText('DN-9').length).toBeGreaterThan(0);
    const readings = screen.getByRole('heading', { name: 'Tank readings' }).closest('section') as HTMLElement;
    expect(readings.textContent).toContain('100.000');
    expect(readings.textContent).toContain('1,095.500');
    expect(readings.textContent).toContain('995.500'); // ارتفاع الخزان
    expect(readings.textContent).toMatch(/No difference/);
    expect(screen.getByText(/5,000\.00|5000\.00/)).toBeTruthy();
  });

  it('hides the cost from a cost-blind viewer entirely', async () => {
    seedUser(APPROVER);
    connect(build({ canSeeCost: false, deliveries: [draft() as never] }));
    await open();
    expect(screen.queryByText('Receiving value')).toBeNull();
    expect(document.body.textContent).not.toMatch(/5,000|5000/);
  });

  it('approves only after an explicit confirmation, sends one POST with the optional note, and shows the stock effect', async () => {
    const user = userEvent.setup();
    seedUser(APPROVER);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    expect(writes()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Approve receiving' }));
    const dialog = await screen.findByRole('dialog');
    expect(writes()).toHaveLength(0); // الحوار لا يكتب
    await user.type(within(dialog).getByLabelText('Approval note (optional)'), '  checked on site  ');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm approval' }));
    expect(await screen.findByText('Receiving approved')).toBeTruthy();
    expect(world.posts).toEqual([{ path: `/fuel-stations/deliveries/${UID(1)}/approve`, method: 'POST', body: { reason: 'checked on site' } }]);
    expect(screen.queryByRole('button', { name: 'Approve receiving' })).toBeNull(); // لا اعتماد ثانٍ
    expect(screen.getAllByText(/added to station stock/i).length).toBeGreaterThan(0);
  });

  it('a double tap on confirm approves once', async () => {
    const user = userEvent.setup();
    seedUser(APPROVER);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    await user.click(screen.getByRole('button', { name: 'Approve receiving' }));
    const dialog = await screen.findByRole('dialog');
    await user.dblClick(within(dialog).getByRole('button', { name: 'Confirm approval' }));
    await screen.findByText('Receiving approved');
    expect(world.posts.filter((p) => p.path.endsWith('/approve'))).toHaveLength(1);
  });

  it('shows the creator hint, and when the station policy refuses the same user the reason is explicit and nothing changes', async () => {
    const user = userEvent.setup();
    seedUser(APPROVER, 'u-creator');
    connect(build({ viewerId: 'u-creator', distinctApprover: true, deliveries: [draft() as never] }));
    await open();
    expect(document.querySelector('[data-creator-hint]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Approve receiving' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    expect(await screen.findByText(/requires a different user to approve/)).toBeTruthy();
    expect(world.deliveries[0].status).toBe('draft');
    expect(screen.getByRole('button', { name: 'Approve receiving' })).toBeTruthy(); // يمكن لمخوَّل آخر لاحقاً
  });

  it('already approved elsewhere: the state is refreshed from the server and no second approval is possible', async () => {
    const user = userEvent.setup();
    seedUser(APPROVER);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    world.deliveries[0].status = 'approved'; // اعتمده مستخدم آخر بينما الشاشة مفتوحة
    await user.click(screen.getByRole('button', { name: 'Approve receiving' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    expect(await screen.findByText(/no longer a draft/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve receiving' })).toBeNull());
    expect(screen.getByText('Approval', { selector: 'h2' })).toBeTruthy();
  });

  it('lost reply on approval: no resend — checking reads the real state and confirms it was applied', async () => {
    const user = userEvent.setup();
    seedUser(APPROVER);
    connect(build({ deliveries: [draft() as never], dropReplyAfterApply: (post) => post.path.endsWith('/approve') }));
    await open();
    await user.click(screen.getByRole('button', { name: 'Approve receiving' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    expect(await screen.findByText(/connection dropped after sending/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText('Receiving approved')).toBeTruthy();
    expect(world.posts.filter((p) => p.path.endsWith('/approve'))).toHaveLength(1);
  });

  it('403 and 404 on approval are shown plainly; a viewer without approval rights is not offered the action', async () => {
    const user = userEvent.setup();
    seedUser(APPROVER);
    connect(build({ deliveries: [draft() as never], beforePost: () => { throw new ApiError(403, 'x', {}); } }));
    await open();
    await user.click(screen.getByRole('button', { name: 'Approve receiving' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    expect(await screen.findByText(/You are not allowed to do this/)).toBeTruthy();
    cleanup();

    seedUser(['fuel_stations.view', 'fuel.delivery.view']);
    connect(build({ deliveries: [draft() as never] }));
    await open();
    expect(screen.queryByRole('button', { name: 'Approve receiving' })).toBeNull();
    expect(screen.getByText(/needs the approval permission/)).toBeTruthy();
    cleanup();

    seedUser(APPROVER);
    connect(build());
    renderOps(<ReceivingDetailScreen id={UID(404)} />);
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });

  it('an approved receiving shows who/when and offers no approval, edit or delete', async () => {
    seedUser(APPROVER);
    connect(build({ deliveries: [draft({ status: 'approved', approved_by: 'u-other', approved_at: '2026-11-06T09:00:00+00:00' }) as never] }));
    await open();
    expect(screen.getByText('Another user')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Approve|Edit|Delete|Reject|Cancel/ })).toBeNull();
  });
});

describe('Arabic RTL and accessibility', () => {
  it('renders the wizard and detail in Arabic with logical layout and no accessibility violations', async () => {
    seedUser(CREATOR);
    connect(build({ deliveries: [draft() as never] }));
    const { container } = renderOps(<ReceivingNewScreen />, 'ar');
    await screen.findByRole('radio', { name: /Acme Oil/ });
    expect(screen.getByText('الخطوة 1 من 5', { exact: false })).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right)-\d/);
    expect((await axe(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
    cleanup();
    const detail = renderOps(<ReceivingDetailScreen id={UID(1)} />, 'ar');
    await screen.findByText('بيانات الاستلام');
    expect((await axe(detail.container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
  });
});
