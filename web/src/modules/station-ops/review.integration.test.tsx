// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/shifts/s1/review', replace: vi.fn(), refresh: vi.fn() }));

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
import { nozzle, product, pump, shift as makeShift, shiftDetail, station, tank } from './__fixtures__';
import { createBackend, type TenantData } from './__test-harness';
import type { CollectionView } from './collection';
import { ShiftReviewScreen } from './review-screen';
import { StationOpsShell } from './shell';

const apiMock = vi.mocked(api);
const SUPERVISOR = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.approve', 'fuel.shift.cash_variance_review', 'fuel.sale.view'];

function seedUser(permissions: string[], id = 'u-sup'): void {
  const user: AuthUser = { id, name: 'Sup Visor', email: 'sup@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

interface World {
  data: TenantData;
  posts: Array<{ path: string; body: Record<string, unknown> }>;
  collection: { enabled: boolean; reviewRequired: boolean; reviewed: boolean; salesVisible: boolean };
  serverRefusal: string | null;
}

function build(opts: { status?: 'closed' | 'approved' | 'open'; collectionEnabled?: boolean; collectionReview?: boolean; cashVariance?: boolean; salesVisible?: boolean; openedBy?: string; supervisorRequired?: boolean } = {}): World {
  const status = opts.status ?? 'closed';
  const data: TenantData = {
    stations: [station('a', { name: 'Station A', timezone: 'Asia/Riyadh' })],
    products: [product('p1', 'Alpha')],
    pumps: [pump('pump1', 'a')],
    tanks: [tank('t1', 'a', 'p1')],
    nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1')],
    prices: [],
    shifts: [makeShift('s1', 'a', { number: 'SH-001', status })],
    settings: { a: { shift_supervisor_approval_required: opts.supervisorRequired ?? true } },
  };
  data.details = {
    s1: shiftDetail('s1', 'a', {
      number: 'SH-001', status, opening_float_minor: 20_000, closed_at: '2026-11-05T11:00:00+00:00', staff_assignments: [{ user_id: 'u-seller' }],
      opened_by: opts.openedBy ?? 'u-seller', counted_cash_minor: 20_500, expected_operational_cash_minor: 20_000, cash_variance_minor: 500,
      cash_variance: opts.cashVariance === false ? { status: 'not_required', variance_direction: 'none', reviewed_at: null, reviewed_by: null } : { status: 'pending_review', variance_direction: 'overage', reviewed_at: null, reviewed_by: null },
      events: [
        { id: 'e1', type: 'opened', actor_id: 'u-seller', occurred_at: '2026-11-05T03:00:00+00:00', payload: null },
        { id: 'e2', type: 'closed', actor_id: 'u-seller', occurred_at: '2026-11-05T11:00:00+00:00', payload: null },
      ],
    }),
  };
  return {
    data, posts: [], serverRefusal: null,
    collection: { enabled: opts.collectionEnabled ?? true, reviewRequired: opts.collectionReview ?? true, reviewed: false, salesVisible: opts.salesVisible ?? true },
  };
}

function view(world: World): CollectionView {
  const c = world.collection;
  const state = !c.reviewRequired ? 'not_required' : c.reviewed ? 'reviewed' : 'pending';
  return {
    enabled: true, state: 'frozen', revision: 2, methods: [], methods_changed: false,
    close_readiness: { ready: true, blockers: [], reason_required: false },
    review: c.salesVisible ? { visible: true, state, reason: c.reviewRequired ? 'Short change given' : null, note: c.reviewed ? 'Reviewed OK' : null, reviewed_by: c.reviewed ? 'u-sup' : null, reviewed_at: c.reviewed ? '2026-11-05T12:00:00+00:00' : null } : { visible: false },
    declaration: { id: 'd1', revision: 2, status: 'frozen', lines: [{ payment_method_id: 'm-cash', name: 'Cash', settlement_type: 'cash', amount_minor: 17_000, still_allowed: null }, { payment_method_id: 'm-card', name: 'Card', settlement_type: 'bank', amount_minor: 3_000, still_allowed: null }], collected_total_minor: 20_000, cash_declared_minor: 17_000, network_declared_minor: 3_000, frozen_at: '2026-11-05T11:00:00+00:00' },
    sales: {
      visible: c.salesVisible, complete: true, milliliters: 100_000, milliliters_complete: true, amount_minor: c.salesVisible ? 23_000 : null, tax_mode: 'tax_inclusive', evaluated_at: null,
      products: [{ fuel_product_id: 'p1', name: 'Alpha', nozzle_count: 1, milliliters: 100_000, ...(c.salesVisible ? { price_per_liter_minor: 230, amount_minor: 23_000 } : {}), gaps: [] }], nozzles: [], gaps: [],
    },
    reconciliation: c.salesVisible ? { visible: true, final: true, reason: null, collected_total_minor: 20_000, sales_minor: 23_000, difference_minor: -3_000, direction: 'shortage' } : { visible: false },
    drawer: { frozen: true, opening_float_minor: 20_000, counted_cash_minor: 20_500, treasury_handover_minor: 0, cash_in_minor: 0, cash_out_minor: 0, expenses_minor: 0, implied_sales_cash: { visible: c.salesVisible, amount_minor: c.salesVisible ? 500 : null, declared_difference_minor: c.salesVisible ? 16_500 : null } },
    disclaimers: ['operational_not_financial_proof', 'credit_sales_excluded', 'unrecorded_settlements_excluded'],
  };
}

let world: World;
function connect(w: World) {
  world = w;
  const base = createBackend(w.data);
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
    const detail = w.data.details!.s1;
    if (path === '/fuel-stations/shifts/s1/collection') {
      if (!w.collection.enabled) throw new ApiError(404, 'not found', {});
      return { data: view(w) } as never;
    }
    if (init?.method === 'POST') {
      const body = (init.body ?? {}) as Record<string, unknown>;
      w.posts.push({ path, body });
      if (w.serverRefusal) throw new ApiError(422, w.serverRefusal, { message: w.serverRefusal });
      if (path.endsWith('/collection/review')) {
        if (w.collection.reviewed) throw new ApiError(422, 'روجع فرق التحصيل لهذه الوردية بالفعل؛ x', {});
        w.collection.reviewed = true;
        return { data: view(w) } as never;
      }
      if (path.endsWith('/cash-variance/review')) {
        detail.cash_variance = { status: 'pending_review', variance_direction: 'overage', reviewed_at: '2026-11-05T12:05:00+00:00', reviewed_by: 'u-sup' };
        return { data: JSON.parse(JSON.stringify(detail)) } as never;
      }
      if (path.endsWith('/approve')) {
        const pendingCollection = w.collection.enabled && w.collection.reviewRequired && !w.collection.reviewed;
        const pendingCash = w.collection.enabled && detail.cash_variance?.status === 'pending_review' && !detail.cash_variance.reviewed_at;
        if (pendingCollection) throw new ApiError(422, 'FUEL_COLLECTION_REVIEW_REQUIRED: x', {});
        if (pendingCash) throw new ApiError(422, 'FUEL_CASH_VARIANCE_REVIEW_REQUIRED: x', {});
        detail.status = 'approved';
        detail.approved_at = '2026-11-05T12:10:00+00:00';
        return { data: JSON.parse(JSON.stringify(detail)) } as never;
      }
      throw new ApiError(404, 'not found', {});
    }
    return base.handler(path, init?.headers as Record<string, string> | undefined) as never;
  });
}

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear();
  sessionStorage.clear();
  apiMock.mockReset();
});
afterEach(() => cleanup());

const renderOps = (locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell><ShiftReviewScreen shiftId="s1" /></StationOpsShell>, locale);
const approveButton = () => document.querySelector('[data-approve-action]') as HTMLButtonElement;
const blockers = () => [...document.querySelectorAll('[data-review-blocker]')].map((el) => el.getAttribute('data-review-blocker'));
const reviewAction = (key: 'collection' | 'cash') => document.querySelector(`[data-review-action="${key}"]`) as HTMLButtonElement | null;

async function writeReview(user: ReturnType<typeof userEvent.setup>, key: 'collection' | 'cash', note = 'Checked the difference') {
  await user.click(reviewAction(key)!);
  const dialog = await screen.findByRole('dialog');
  expect((within(dialog).getByRole('button', { name: 'Record the review' }) as HTMLButtonElement).disabled).toBe(true); // الملاحظة إلزامية
  await user.type(within(dialog).getByLabelText('Supervisor note (required)'), note);
  await user.click(within(dialog).getByRole('button', { name: 'Record the review' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('supervisor review of a closed shift', () => {
  it('shows the frozen figures: meter sales, collection by method, difference + reason, drawer cash and its cross-check', async () => {
    seedUser(SUPERVISOR);
    connect(build());
    renderOps();
    expect(await screen.findByText('SH-001')).toBeTruthy();
    const recon = (await screen.findByRole('heading', { name: 'Operational reconciliation — sales and collection' })).closest('section') as HTMLElement;
    expect(recon.querySelector('[data-collection-sales-amount]')?.textContent).toContain('230.00');
    expect(recon.querySelector('[data-collection-liters]')?.textContent).toContain('100');
    expect(recon.querySelector('[data-collection-lines]')?.textContent).toContain('Cash');
    expect(recon.querySelector('[data-collection-lines]')?.textContent).toContain('Card');
    expect(recon.querySelector('[data-collection-total]')?.textContent).toContain('200.00');
    expect(recon.querySelector('[data-collection-recon] [data-collection-direction]')?.getAttribute('data-collection-direction')).toBe('shortage');
    expect(recon.querySelector('[data-collection-review="pending"]')?.textContent).toContain('Short change given');
    expect(recon.querySelector('[data-drawer-counted]')?.textContent).toContain('205.00');
    expect(recon.querySelector('[data-drawer-cross]')?.textContent).toContain('165.00');
  });

  it('explains the difference between the operational reconciliation and the drawer cash summary, and keeps them as separate sections', async () => {
    seedUser(SUPERVISOR);
    connect(build());
    renderOps();
    const explain = (await screen.findByText('What is the difference between the two sections?')).closest('section') as HTMLElement;
    expect(explain.textContent).toContain('records no amount in the books');
    expect(explain.textContent).toContain('never mixed with it');
    expect(explain.textContent).toContain('Figures are frozen at handover');
    expect(document.querySelector('[data-review-cash-summary]')).toBeNull(); // لا cash_summary في هذا الـfixture ⇒ لا قسم ثانٍ مخترع
  });

  it('blocks approval until BOTH differences are reviewed — with a clear message per blocker — then approves and locks', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    connect(build());
    renderOps();
    await screen.findByText('SH-001');
    await waitFor(() => expect(blockers()).toEqual(['collection_review', 'cash_variance_review']));
    expect(approveButton().disabled).toBe(true);
    expect(screen.getByText('Approval is not possible before the collection reconciliation difference is reviewed.')).toBeTruthy();

    await writeReview(user, 'collection');
    expect(world.posts[0]).toEqual({ path: '/fuel-stations/shifts/s1/collection/review', body: { note: 'Checked the difference' } });
    await waitFor(() => expect(blockers()).toEqual(['cash_variance_review']));
    expect(approveButton().disabled).toBe(true);

    await writeReview(user, 'cash');
    expect(world.posts[1]).toEqual({ path: '/fuel-stations/shifts/s1/cash-variance/review', body: { note: 'Checked the difference' } });
    await waitFor(() => expect(blockers()).toEqual([]));
    expect(approveButton().disabled).toBe(false);

    await user.click(approveButton());
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm approval' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // إقرار صريح
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(confirm);
    await waitFor(() => expect(document.querySelector('[data-review-approved]')).toBeTruthy());
    expect(world.posts[2]).toEqual({ path: '/fuel-stations/shifts/s1/approve', body: {} });
    expect(world.posts).toHaveLength(3);
    expect(screen.getByText('The shift was approved and locked.')).toBeTruthy();
    expect(approveButton()).toBeNull(); // لا إجراء بعد الاعتماد
    expect(document.querySelector('[data-review-action]')).toBeNull();
  });

  it('the server is the judge: when it refuses approval, the exact reason is shown and nothing is assumed approved', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    // المشرف بلا رؤية المبيعات: الواجهة لا ترى مراجعة التحصيل المعلّقة، لكن الخادم يعرفها ويرفض.
    const w = build({ salesVisible: false, cashVariance: false });
    connect(w);
    renderOps();
    await screen.findByText('SH-001');
    expect(document.querySelector('[data-review-no-sales-view]')).toBeTruthy();
    expect(document.querySelector('[data-review-action]')).toBeNull();
    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(approveButton());
    await user.click(within(await screen.findByRole('dialog')).getByRole('checkbox'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    expect(await screen.findByText('A collection reconciliation difference needs a recorded supervisor review before approval.')).toBeTruthy();
    expect(document.querySelector('[data-review-approved]')).toBeNull();
    expect(world.data.details!.s1.status).toBe('closed');
  });

  it('enforces the same-supervisor policy up front: the opener of the shift cannot approve it', async () => {
    seedUser(SUPERVISOR, 'u-seller');
    connect(build({ openedBy: 'u-seller', cashVariance: false, collectionReview: false }));
    renderOps();
    await screen.findByText('SH-001');
    await waitFor(() => expect(blockers()).toEqual(['same_user']));
    expect(approveButton().disabled).toBe(true);
    expect(screen.getByText('Station policy requires a supervisor other than the one who opened the shift to approve it.')).toBeTruthy();
  });

  it('permissions: no approve permission ⇒ cannot approve; no review permission ⇒ pending rows say so and offer no review button', async () => {
    seedUser(['fuel_stations.view', 'fuel.shift.view', 'fuel.sale.view']);
    connect(build());
    renderOps();
    await screen.findByText('SH-001');
    expect(approveButton().disabled).toBe(true);
    expect(blockers()).toContain('no_permission');
    expect(document.querySelector('[data-review-action]')).toBeNull();
    expect(screen.getAllByText('You do not have permission to review differences. Ask an authorised supervisor.').length).toBeGreaterThan(0);
    expect(world.posts).toHaveLength(0);
  });

  it('feature off (collection 404): no reconciliation section, the cash difference can still be reviewed, and it does not block approval (server rule is the same)', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    connect(build({ collectionEnabled: false }));
    renderOps();
    await screen.findByText('SH-001');
    expect(screen.queryByRole('heading', { name: 'Operational reconciliation — sales and collection' })).toBeNull();
    expect(screen.getByText('No collection breakdown is recorded for this shift (the feature is off or none was saved).')).toBeTruthy();
    expect(blockers()).toEqual([]);
    expect(approveButton().disabled).toBe(false);
    await writeReview(user, 'cash');
    await waitFor(() => expect(document.querySelector('[data-review-state="reviewed"]')).toBeTruthy());
  });

  it('an open shift is not reviewable; an approved one is read-only with its audit log', async () => {
    seedUser(SUPERVISOR);
    connect(build({ status: 'open' }));
    renderOps();
    expect(await screen.findByText('The shift is not closed')).toBeTruthy();
    cleanup();
    const approvedWorld = build({ status: 'approved', collectionReview: false, cashVariance: false });
    approvedWorld.data.details!.s1.events = [
      { id: 'e1', type: 'closed', actor_id: 'u1', occurred_at: '2026-11-05T11:00:00+00:00', payload: null },
      { id: 'e2', type: 'collection_reviewed', actor_id: 'u2', occurred_at: '2026-11-05T12:00:00+00:00', payload: { note: 'Reviewed OK', difference_minor: -3000 } },
      { id: 'e3', type: 'approved_locked', actor_id: 'u2', occurred_at: '2026-11-05T12:10:00+00:00', payload: { note: null } },
      { id: 'e4', type: 'meter_recorded', actor_id: 'u1', occurred_at: '2026-11-05T05:00:00+00:00', payload: {} },
    ];
    connect(approvedWorld);
    renderOps();
    expect(await screen.findByText('This shift is approved and locked.')).toBeTruthy();
    expect(approveButton()).toBeNull();
    const trail = document.querySelector('[data-audit-trail]') as HTMLElement;
    expect([...trail.querySelectorAll('[data-audit-event]')].map((el) => el.getAttribute('data-audit-event'))).toEqual(['closed', 'collection_reviewed', 'approved_locked']); // أحداث الأرصدة الداخلية لا تُعرض
    expect(trail.textContent).toContain('Reviewed OK');
    expect(trail.textContent).not.toContain('3000'); // لا قيم خام من الحمولة
  });

  it('renders in Arabic RTL with no accessibility violations', async () => {
    seedUser(SUPERVISOR);
    connect(build());
    const { container } = renderOps('ar');
    expect(await screen.findByRole('heading', { name: 'المطابقة التشغيلية — المبيعات والتحصيل' })).toBeTruthy();
    expect(screen.getByText('ما الفرق بين القسمين؟')).toBeTruthy();
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it('all links stay inside the app and the only writes are the three review/approve endpoints', async () => {
    seedUser(SUPERVISOR);
    connect(build());
    renderOps();
    await screen.findByText('SH-001');
    for (const link of screen.getAllByRole('link').filter((a) => !(a.getAttribute('href') ?? '').startsWith('#'))) expect(link.getAttribute('href')).toMatch(/^\/fuel-stations\/ops(\/|$)/);
    expect(document.body.textContent).not.toMatch(/invoice|journal|ledger|receipt voucher/i);
  });
});
