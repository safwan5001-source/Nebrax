// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/shifts/s1/handover', replace: vi.fn(), refresh: vi.fn() }));

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
import { createWriteBackend } from './__write-backend';
import type { CollectionView } from './collection';
import { HandoverScreen } from './handover-screen';
import { ShiftDetailScreen } from './shift-detail-screen';
import { StationOpsShell } from './shell';

const apiMock = vi.mocked(api);
const SELLER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close'];
const SUPERVISOR_SALES = [...SELLER, 'fuel.sale.view'];

function seedUser(permissions: string[]): void {
  const user: AuthUser = { id: 'u1', name: 'Sami Operator', email: 'sami@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

function data(): TenantData {
  const d: TenantData = {
    stations: [station('a', { name: 'Station A', timezone: 'Asia/Riyadh' })],
    products: [product('p1', 'Alpha')],
    pumps: [pump('pump1', 'a')],
    tanks: [tank('t1', 'a', 'p1')],
    nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1')],
    prices: [],
    shifts: [makeShift('s1', 'a', { number: 'SH-001', status: 'open' })],
  };
  d.details = {
    s1: shiftDetail('s1', 'a', {
      number: 'SH-001', opening_float_minor: 20_000, staff_assignments: [{ user_id: 'u1' }], cash_movements: [],
      meter_readings: [meter('o', 'n1', 'opening', 100_000), meter('c', 'n1', 'closing', 200_000)],
      tank_readings: [tankReading('to', 't1', 'opening', 9_000_000), tankReading('tc', 't1', 'closing', 8_900_000)],
    }),
  };
  return d;
}

/* ───────── خادم الإقرار الوهمي بحالة: يحاكي قواعد FuelShiftCollectionService (النصوص/الرموز الحرفية) ───────── */
interface Method { id: string; name: string; settlement_type: 'cash' | 'bank' }
interface ServerState { reasonRequired: boolean; methods: Method[]; revision: number; lines: Array<{ payment_method_id: string; amount_minor: number }> | null; salesVisible: boolean; salesComplete: boolean; enabled: boolean; keys: Map<string, string> }

function collectionServer(initial: Partial<ServerState> = {}) {
  const state: ServerState = {
    methods: [{ id: 'm-cash', name: 'Cash', settlement_type: 'cash' }, { id: 'm-bank', name: 'Card', settlement_type: 'bank' }],
    reasonRequired: false, revision: 0, lines: null, salesVisible: true, salesComplete: true, enabled: true, keys: new Map(), ...initial,
  };
  const posts: Array<{ path: string; body: { idempotency_key: string; base_revision: number; lines: Array<{ payment_method_id: string; amount_minor: number }> } }> = [];
  const view = (): CollectionView => {
    const declared = state.lines !== null;
    const total = declared ? state.lines!.reduce((s, l) => s + l.amount_minor, 0) : 0;
    const cash = declared ? state.lines!.filter((l) => state.methods.find((m) => m.id === l.payment_method_id)?.settlement_type === 'cash').reduce((s, l) => s + l.amount_minor, 0) : 0;
    const amount = state.salesComplete ? 23_000 : null;
    return {
      enabled: true, state: declared ? 'declared' : 'none', revision: state.revision,
      methods: state.methods.map((m) => ({ ...m, name_en: null, saved_amount_minor: state.lines?.find((l) => l.payment_method_id === m.id)?.amount_minor ?? null })),
      methods_changed: declared && JSON.stringify(state.lines!.map((l) => l.payment_method_id).sort()) !== JSON.stringify(state.methods.map((m) => m.id).sort()),
      close_readiness: {
        ready: declared && !(JSON.stringify(state.lines!.map((l) => l.payment_method_id).sort()) !== JSON.stringify(state.methods.map((m) => m.id).sort())) && state.methods.length > 0,
        blockers: state.methods.length === 0 ? ['no_methods'] : !declared ? ['required'] : JSON.stringify(state.lines!.map((l) => l.payment_method_id).sort()) !== JSON.stringify(state.methods.map((m) => m.id).sort()) ? ['incomplete'] : [],
        reason_required: state.reasonRequired && declared,
      },
      review: { visible: false },
      declaration: declared ? {
        id: 'd1', revision: state.revision, status: 'declared',
        lines: state.lines!.map((l) => ({ ...l, name: state.methods.find((m) => m.id === l.payment_method_id)?.name ?? '?', settlement_type: state.methods.find((m) => m.id === l.payment_method_id)?.settlement_type ?? 'cash', still_allowed: true })),
        collected_total_minor: total, cash_declared_minor: cash, network_declared_minor: total - cash,
      } : null,
      sales: {
        visible: state.salesVisible, complete: state.salesComplete, milliliters: 100_000, milliliters_complete: state.salesComplete,
        amount_minor: state.salesVisible ? amount : null, tax_mode: 'tax_inclusive', evaluated_at: '2026-11-05T10:00:00+00:00',
        products: [{ fuel_product_id: 'p1', name: 'Alpha', nozzle_count: 1, milliliters: 100_000, ...(state.salesVisible ? { price_per_liter_minor: 230, price_source: 'station_override', amount_minor: amount } : {}), gaps: state.salesComplete ? [] : ['price_unavailable'] }],
        nozzles: [], gaps: state.salesComplete ? [] : ['price_unavailable'],
      },
      reconciliation: !state.salesVisible ? { visible: false } : declared && amount !== null
        ? { visible: true, final: true, reason: null, collected_total_minor: total, sales_minor: amount, difference_minor: total - amount, direction: total === amount ? 'none' : total > amount ? 'overage' : 'shortage' }
        : { visible: true, final: false, reason: declared ? 'sales_incomplete' : 'not_declared', collected_total_minor: declared ? total : null, difference_minor: null, direction: null },
      drawer: { frozen: false, opening_float_minor: 20_000, counted_cash_minor: null, treasury_handover_minor: 10_000, cash_in_minor: 500, cash_out_minor: 10_000, expenses_minor: 0, implied_sales_cash: { visible: state.salesVisible, amount_minor: null, declared_difference_minor: null } },
      disclaimers: ['operational_not_financial_proof', 'credit_sales_excluded', 'unrecorded_settlements_excluded'],
    };
  };
  const handle = (path: string, init?: { method?: string; body?: unknown }) => {
    if (!state.enabled) throw new ApiError(404, 'not found', {});
    if (init?.method !== 'POST') return { data: view() };
    const body = init.body as (typeof posts)[number]['body'];
    posts.push({ path, body });
    const hash = JSON.stringify([...body.lines].sort((a, b) => a.payment_method_id.localeCompare(b.payment_method_id)));
    const used = state.keys.get(body.idempotency_key);
    if (used !== undefined) {
      if (used !== hash) throw new ApiError(409, 'FUEL_COLLECTION_IDEMPOTENCY_CONFLICT: x', { reason: 'idempotency_conflict', current_revision: state.revision });
      return { data: view(), meta: { replayed: true, unchanged: false } };
    }
    if (body.base_revision !== state.revision) throw new ApiError(409, 'FUEL_COLLECTION_STALE_REVISION: x', { reason: 'stale_revision', current_revision: state.revision });
    const ids = body.lines.map((l) => l.payment_method_id);
    if (ids.some((id) => !state.methods.some((m) => m.id === id))) throw new ApiError(422, 'FUEL_COLLECTION_METHOD_NOT_ALLOWED: x', { message: 'FUEL_COLLECTION_METHOD_NOT_ALLOWED: x' });
    if (state.methods.some((m) => !ids.includes(m.id))) throw new ApiError(422, 'FUEL_COLLECTION_METHODS_CHANGED: x', { message: 'FUEL_COLLECTION_METHODS_CHANGED: x' });
    state.revision += 1;
    state.lines = body.lines;
    state.keys.set(body.idempotency_key, hash);
    return { data: view(), meta: { replayed: false, unchanged: false } };
  };
  return { state, posts, handle };
}

let server: ReturnType<typeof collectionServer>;
function connect(options: { server?: Partial<ServerState>; permissions?: string[] } = {}) {
  seedUser(options.permissions ?? SELLER);
  server = collectionServer(options.server);
  const backend = createWriteBackend(data());
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
    if (path.endsWith('/collection')) return server.handle(path, init) as never;
    return backend.handler(path, init) as never;
  });
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear();
  sessionStorage.clear();
  apiMock.mockReset();
});
afterEach(() => cleanup());

const renderOps = (ui: React.ReactElement, locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell>{ui}</StationOpsShell>, locale);
const amountInput = (id: string) => screen.findByTestId(`collection-amount-${id}`) as Promise<HTMLInputElement>;
const saveButton = () => document.querySelector('[data-save-collection]') as HTMLButtonElement;

describe('collection section on the handover screen', () => {
  it('gate closed (404): nothing is rendered and the handover screen is exactly as before', async () => {
    connect({ server: { enabled: false } });
    renderOps(<HandoverScreen shiftId="s1" />);
    expect(await screen.findByText('Every required reading is recorded.')).toBeTruthy();
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => String(p).endsWith('/collection'))).toBe(true));
    expect(screen.queryByText('Sales and collection')).toBeNull();
    expect(document.querySelector('[data-collection]')).toBeNull();
  });

  it('renders one input per CURRENT payment method (by server id), shows meter sales with the product breakdown, and saves nothing until asked', async () => {
    connect({ permissions: SUPERVISOR_SALES });
    renderOps(<HandoverScreen shiftId="s1" />);
    expect(await screen.findByText('Sales and collection')).toBeTruthy();
    expect(await amountInput('m-cash')).toBeTruthy();
    expect(await amountInput('m-bank')).toBeTruthy();
    expect(document.querySelector('[data-collection-liters]')?.textContent).toContain('100');
    expect(document.querySelector('[data-collection-sales-amount]')?.textContent).toContain('230.00');
    expect(document.querySelectorAll('[data-collection-products] li')).toHaveLength(1);
    expect(saveButton().disabled).toBe(true);
    expect(server.posts).toHaveLength(0);
  });

  it('previews the difference (shortage) as the user types, never as a final number before saving; disclaimers are shown', async () => {
    const user = userEvent.setup();
    connect({ permissions: SUPERVISOR_SALES });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await amountInput('m-cash'), '200');
    expect(document.querySelector('[data-collection-recon]')?.textContent).toContain('Fill in every');
    await user.type(await amountInput('m-bank'), '20');
    const recon = document.querySelector('[data-collection-recon]') as HTMLElement;
    expect(document.querySelector('[data-collection-total]')?.textContent).toContain('220.00');
    expect(recon.querySelector('[data-collection-direction]')?.getAttribute('data-collection-direction')).toBe('shortage');
    expect(recon.textContent).toContain('10.00');
    expect(recon.textContent).toContain('not saved yet');
    const notes = document.querySelector('[data-collection-disclaimers]')?.textContent ?? '';
    expect(notes).toContain('not proof of an officially recorded collection');
    expect(notes).toContain('Sales on account are not part of this check');
  });

  it('save sends the payment-method ids and halalas, base revision 0 and a key; a double click sends ONE request; success needs the echo to match', async () => {
    const user = userEvent.setup();
    connect({ permissions: SUPERVISOR_SALES });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await amountInput('m-cash'), '200.50');
    await user.type(await amountInput('m-bank'), '29.5');
    await user.dblClick(saveButton());
    await waitFor(() => expect(document.querySelector('[data-collection-saved]')).toBeTruthy());
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0].path).toBe('/fuel-stations/shifts/s1/collection');
    expect(server.posts[0].body).toMatchObject({ base_revision: 0, lines: [{ payment_method_id: 'm-cash', amount_minor: 20_050 }, { payment_method_id: 'm-bank', amount_minor: 2_950 }] });
    expect(String(server.posts[0].body.idempotency_key)).toMatch(/^awj-ops-/);
    expect(document.querySelector('[data-collection-saved]')?.textContent).toContain('version 1');
    expect(document.querySelector('[data-collection-direction]')?.getAttribute('data-collection-direction')).toBe('none');
  });

  it('the list follows the station settings automatically: a newly enabled method appears and a disabled one disappears on refocus, keeping typed values', async () => {
    const user = userEvent.setup();
    connect({ permissions: SUPERVISOR_SALES });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await amountInput('m-cash'), '150');
    // الإعدادات تتغير في الخادم: تعطيل البطاقة وتفعيل التحويل.
    server.state.methods = [{ id: 'm-cash', name: 'Cash', settlement_type: 'cash' }, { id: 'm-transfer', name: 'Transfer', settlement_type: 'bank' }];
    const realNow = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 10 * 60_000); // يتجاوز مهلة التكرار
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    spy.mockRestore();
    expect(await amountInput('m-transfer')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('collection-amount-m-bank')).toBeNull());
    expect((screen.getByTestId('collection-amount-m-cash') as HTMLInputElement).value).toBe('150');
    expect((screen.getByTestId('collection-amount-m-transfer') as HTMLInputElement).value).toBe('');
    expect(document.querySelector('[data-methods-updated]')).toBeTruthy();
    expect(saveButton().disabled).toBe(true); // الجديدة تحتاج مبلغاً صريحاً
  });

  it('a method disabled after the screen was drawn is refused by the server: honest message, list refreshed, nothing assumed saved', async () => {
    const user = userEvent.setup();
    connect({ permissions: SUPERVISOR_SALES });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await amountInput('m-cash'), '100');
    await user.type(await amountInput('m-bank'), '100');
    server.state.methods = [{ id: 'm-cash', name: 'Cash', settlement_type: 'cash' }];
    await user.click(saveButton());
    expect(await screen.findByText(/now disabled or not allowed for this station/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('collection-amount-m-bank')).toBeNull());
    expect(server.state.lines).toBeNull();
  });

  it('a stale base revision (saved from another device) is a clear conflict, not a silent overwrite', async () => {
    const user = userEvent.setup();
    connect({ permissions: SUPERVISOR_SALES });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await amountInput('m-cash'), '100');
    await user.type(await amountInput('m-bank'), '100');
    server.state.revision = 3; // جهاز آخر حفظ قبلنا
    server.state.lines = [{ payment_method_id: 'm-cash', amount_minor: 1 }, { payment_method_id: 'm-bank', amount_minor: 1 }];
    await user.click(saveButton());
    expect(await screen.findByText(/changed from another device/)).toBeTruthy();
    expect(server.state.lines).toEqual([{ payment_method_id: 'm-cash', amount_minor: 1 }, { payment_method_id: 'm-bank', amount_minor: 1 }]);
  });

  it('incomplete sales (no price) show "unavailable" and the reason — never a trusted amount or a final difference', async () => {
    const user = userEvent.setup();
    connect({ permissions: SUPERVISOR_SALES, server: { salesComplete: false } });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await amountInput('m-cash'), '100');
    await user.type(await amountInput('m-bank'), '0');
    expect(document.querySelector('[data-collection-sales-amount]')?.textContent).toContain('Unavailable');
    expect(document.querySelector('[data-collection-gaps]')?.textContent).toContain('no effective price');
    expect(document.querySelector('[data-recon-not-final]')).toBeTruthy();
    expect(document.querySelector('[data-collection-direction]')).toBeNull();
  });

  it('a seller without sales visibility sees litres but no price/amount/difference, and can still save', async () => {
    const user = userEvent.setup();
    connect({ permissions: SELLER, server: { salesVisible: false } });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await amountInput('m-cash'), '100');
    await user.type(await amountInput('m-bank'), '0');
    expect(document.querySelector('[data-collection-liters]')?.textContent).toContain('100');
    expect(document.querySelector('[data-collection-sales-amount]')?.textContent).toContain('Shown to the supervisor');
    expect(document.querySelector('[data-collection-products]')).toBeNull();
    expect(document.querySelector('[data-collection-recon]')?.textContent).toContain('Reviewed by the supervisor');
    expect(document.querySelector('[data-collection-direction]')).toBeNull();
    await user.click(saveButton());
    await waitFor(() => expect(server.state.revision).toBe(1));
  });

  it('separates the drawer cash from the float and the treasury handover, and previews the sales cash the drawer implies', async () => {
    const user = userEvent.setup();
    connect({ permissions: SUPERVISOR_SALES });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await amountInput('m-cash'), '200');
    await user.type(await amountInput('m-bank'), '30');
    await user.type(await screen.findByTestId('counted-cash'), '305');
    const drawer = document.querySelector('[data-collection-drawer]') as HTMLElement;
    expect(drawer.querySelector('[data-drawer-opening]')?.textContent).toContain('200.00');
    expect(drawer.querySelector('[data-drawer-handover]')?.textContent).toContain('100.00');
    expect(drawer.querySelector('[data-drawer-counted]')?.textContent).toContain('305.00');
    expect(drawer.querySelector('[data-drawer-implied]')?.textContent).toContain('200.00'); // 305 − 200 − 5 + 100
    expect(drawer.querySelector('[data-drawer-cross]')?.getAttribute('data-drawer-cross') ?? '').toBe('');
    expect(drawer.querySelector('[data-collection-direction]')?.getAttribute('data-collection-direction')).toBe('none');
  });

  const reviewButton = () => screen.getByRole('button', { name: 'Review and hand over the shift' }) as HTMLButtonElement;

  it('Q1: with the feature on, the handover is blocked until a complete declaration is saved — then it opens', async () => {
    const user = userEvent.setup();
    connect({ permissions: SUPERVISOR_SALES });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await screen.findByTestId('counted-cash'), '300');
    await screen.findByTestId('collection-amount-m-cash');
    expect(reviewButton().disabled).toBe(true);
    expect(document.querySelector('[data-handover-collection-blocked]')?.textContent).toContain('Save the collection breakdown');

    await user.type(await amountInput('m-cash'), '200');
    await user.type(await amountInput('m-bank'), '30');
    expect(reviewButton().disabled).toBe(true); // مدخلات غير محفوظة
    await user.click(saveButton());
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    expect(document.querySelector('[data-handover-collection-blocked]')).toBeNull();

    // تعديل بعد الحفظ يُغلق الباب من جديد حتى يُحفظ.
    await user.type(await amountInput('m-bank'), '1');
    await waitFor(() => expect(reviewButton().disabled).toBe(true));
    expect(document.querySelector('[data-handover-collection-blocked]')?.textContent).toContain('not saved');
  });

  it('Q1: a method enabled after the save makes the saved breakdown incomplete and blocks the handover', async () => {
    const user = userEvent.setup();
    connect({ permissions: SUPERVISOR_SALES });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await screen.findByTestId('counted-cash'), '300');
    await user.type(await amountInput('m-cash'), '200');
    await user.type(await amountInput('m-bank'), '30');
    await user.click(saveButton());
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    server.state.methods = [...server.state.methods, { id: 'm-transfer', name: 'Transfer', settlement_type: 'bank' }];
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    spy.mockRestore();
    await waitFor(() => expect(reviewButton().disabled).toBe(true));
    expect(document.querySelector('[data-handover-collection-blocked]')?.textContent).toContain('Enter the amounts and save');
  });

  it('Q1: no enabled methods ⇒ blocked with a clear reason (feature on)', async () => {
    connect({ permissions: SUPERVISOR_SALES, server: { methods: [] } });
    renderOps(<HandoverScreen shiftId="s1" />);
    await screen.findByText('Sales and collection');
    await waitFor(() => expect(document.querySelector('[data-handover-collection-blocked]')?.textContent).toContain('No payment methods are enabled'));
    expect(reviewButton().disabled).toBe(true);
  });

  it('Q3: a difference reason becomes mandatory (only when the server says the viewer sees a difference)', async () => {
    const user = userEvent.setup();
    connect({ permissions: SUPERVISOR_SALES, server: { reasonRequired: true } });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await screen.findByTestId('counted-cash'), '300');
    await user.type(await amountInput('m-cash'), '200');
    await user.type(await amountInput('m-bank'), '20');
    await user.click(saveButton());
    await waitFor(() => expect(document.querySelector('[data-handover-reason-missing]')).toBeTruthy());
    expect(reviewButton().disabled).toBe(true);
    expect(screen.getByLabelText('Reason for the difference (required)')).toBeTruthy();
    await user.type(screen.getByLabelText('Reason for the difference (required)'), 'Short change given');
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
  });

  it('Q2: a seller without sales visibility is never asked for a difference reason', async () => {
    const user = userEvent.setup();
    connect({ permissions: SELLER, server: { salesVisible: false } }); // الخادم لا يعلن reason_required لمن لا يرى الفرق
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await screen.findByTestId('counted-cash'), '300');
    await user.type(await amountInput('m-cash'), '100');
    await user.type(await amountInput('m-bank'), '0');
    await user.click(saveButton());
    await waitFor(() => expect(reviewButton().disabled).toBe(false));
    expect(document.querySelector('[data-handover-reason-missing]')).toBeNull();
    expect(screen.queryByLabelText('Reason for the difference (required)')).toBeNull();
  });

  it('renders in Arabic (RTL) with the same structure and no accessibility violations', async () => {
    connect({ permissions: SUPERVISOR_SALES });
    const { container } = renderOps(<HandoverScreen shiftId="s1" />, 'ar');
    expect(await screen.findByText('المبيعات والتحصيل')).toBeTruthy();
    expect(await amountInput('m-cash')).toBeTruthy();
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});

describe('collection on the shift details (supervisor, read only)', () => {
  it('shows the saved breakdown and the reconciliation, with no input and no write', async () => {
    seedUser(SUPERVISOR_SALES);
    server = collectionServer();
    server.state.revision = 1;
    server.state.lines = [{ payment_method_id: 'm-cash', amount_minor: 20_000 }, { payment_method_id: 'm-bank', amount_minor: 2_000 }];
    const backend = createWriteBackend(data());
    apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
      if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
      if (path.endsWith('/collection')) return server.handle(path, init) as never;
      return backend.handler(path, init) as never;
    });
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    const section = await waitFor(() => {
      const el = document.querySelector('[data-collection-readonly]');
      if (!el) throw new Error('not yet');
      return el as HTMLElement;
    });
    expect(section.querySelector('[data-collection-total]')?.textContent).toContain('220.00');
    expect(section.querySelector('[data-collection-direction]')?.getAttribute('data-collection-direction')).toBe('shortage');
    expect(section.querySelectorAll('input')).toHaveLength(0);
    expect(server.posts).toHaveLength(0);
  });

  it('gate closed: no section on the details screen either', async () => {
    seedUser(SUPERVISOR_SALES);
    server = collectionServer({ enabled: false });
    const backend = createWriteBackend(data());
    apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
      if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
      if (path.endsWith('/collection')) return server.handle(path, init) as never;
      return backend.handler(path, init) as never;
    });
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    await screen.findByText('SH-001');
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => String(p).endsWith('/collection'))).toBe(true));
    expect(document.querySelector('[data-collection-readonly]')).toBeNull();
  });
});
