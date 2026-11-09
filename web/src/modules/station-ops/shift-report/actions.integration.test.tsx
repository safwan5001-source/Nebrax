// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/shifts/s1', replace: vi.fn(), refresh: vi.fn() }));
const share = vi.hoisted(() => ({ openForPrint: vi.fn(() => true), downloadBlob: vi.fn(), shareBlob: vi.fn(async () => 'shared' as const) }));
const pdf = vi.hoisted(() => ({ create: vi.fn(async () => new Blob(['%PDF-fake'], { type: 'application/pdf' })) }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
}));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', vat_number: '300000000000003', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));
vi.mock('../receiving/documents/share', () => share);
// رسم الـPDF الفعلي مُغطّى في pdf.test.ts؛ هنا نختبر سلوك الإجراءات (متى تظهر، ماذا تستدعي، ماذا لا تكتب).
vi.mock('./pdf', () => ({ createShiftReportPdf: pdf.create }));

import { ApiError, api } from '@/lib/api';
import { meter, nozzle, product, pump, shift as makeShift, shiftDetail, station, tank, tankReading } from '../__fixtures__';
import type { TenantData } from '../__test-harness';
import { createWriteBackend, type WriteBackend } from '../__write-backend';
import { HandoverScreen } from '../handover-screen';
import type { CollectionView } from '../collection';
import type { ShiftDetail } from '../schemas';
import { ShiftDetailScreen } from '../shift-detail-screen';
import { StationOpsShell } from '../shell';
import { frozenCollection } from './__fixtures__';
import { SHIFT_REPORT_PAPER_KEY } from './actions';
import type { AuthUser } from '@/lib/auth';

const apiMock = vi.mocked(api);
const SELLER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close'];

function seedUser(permissions: string[] = SELLER): void {
  const user: AuthUser = { id: 'u1', name: 'Sami Operator', email: 'sami@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

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
const allReadings = (): Partial<ShiftDetail> => ({
  meter_readings: ['n1', 'n2'].flatMap((id, i) => [meter(`o${i}`, id, 'opening', 100_000), meter(`c${i}`, id, 'closing', 150_000)]),
  tank_readings: ['t1', 't2'].flatMap((id, i) => [tankReading(`to${i}`, id, 'opening', 9_000_000), tankReading(`tc${i}`, id, 'closing', 8_000_000)]),
});
function withShift(over: Partial<ShiftDetail> = {}): TenantData {
  const data = baseData();
  data.shifts = [makeShift('s1', 'a', { number: 'SH-001', status: (over.status as string) ?? 'open' })];
  data.details = { s1: shiftDetail('s1', 'a', { number: 'SH-001', opening_float_minor: 50_000, staff_assignments: [{ user_id: 'u1' }], cash_movements: [], ...over }) };
  return data;
}
const CLOSED: Partial<ShiftDetail> = { status: 'closed', closed_by: 'u1', opened_at: '2026-11-03T05:00:00+00:00', closed_at: '2026-11-03T13:00:00+00:00', counted_cash_minor: 50_000, expected_operational_cash_minor: 50_000, cash_variance_minor: 0, operational_meter_milliliters: 100_000, ...allReadings() };

/** سلوك مسار التحصيل: عرض مجمَّد/404/500/بطيء — كل ما عداه للخادم الوهمي. */
type CollectionMode = { kind: 'view'; view: CollectionView } | { kind: 'error'; status: number } | { kind: 'afterClose'; view: CollectionView } | { kind: 'flaky'; view: CollectionView; state: { failing: boolean } };
let backend: WriteBackend;
let collectionCalls = 0;
let mode: CollectionMode = { kind: 'error', status: 404 };

function connect(data: TenantData, collection: CollectionMode = { kind: 'view', view: frozenCollection() }) {
  mode = collection;
  collectionCalls = 0;
  backend = createWriteBackend(data);
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
    if (path.endsWith('/collection') && init?.method !== 'POST') {
      collectionCalls += 1;
      const step = mode;
      if (step.kind === 'view') return { data: step.view } as never;
      // إغلاق حيّ: قبل الإغلاق لا إقرار (404 كبوابة مغلقة فلا يعترض الإغلاق)، وبعده لقطة مجمَّدة كما يفعل الخادم.
      if (step.kind === 'flaky') {
        if (step.state.failing) throw new ApiError(500, 'x', {});
        return { data: step.view } as never;
      }
      if (step.kind === 'afterClose') {
        if (backend.detail('s1').status === 'open') throw new ApiError(404, 'x', {});
        return { data: step.view } as never;
      }
      if (step.kind === 'error') throw new ApiError(step.status, 'x', {});
    }
    return backend.handler(path, init) as never;
  });
}

const renderOps = (ui: React.ReactElement, locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell>{ui}</StationOpsShell>, locale);
const actionsRoot = () => document.querySelector('[data-shift-report-actions]') as HTMLElement | null;
const reportButton = (name: string) => document.querySelector(`[data-report-action="${name}"]`) as HTMLButtonElement;
const field = (testId: string) => screen.findByTestId(testId) as Promise<HTMLInputElement>;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  apiMock.mockReset();
  share.openForPrint.mockClear().mockReturnValue(true);
  share.downloadBlob.mockClear();
  share.shareBlob.mockClear().mockResolvedValue('shared');
  pdf.create.mockClear().mockImplementation(async () => new Blob(['%PDF-fake'], { type: 'application/pdf' }));
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  seedUser();
});
afterEach(cleanup);

const confirmClose = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Review and hand over the shift' }));
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('checkbox'));
  await user.click(within(dialog).getByRole('button', { name: 'Confirm handover' }));
};

describe('(1) successful close → report actions in the same page', () => {
  it('shows preview / print / download / share ONLY after the server confirmed the close, with no extra write', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()), { kind: 'afterClose', view: frozenCollection() });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await field('counted-cash'), '500');
    expect(actionsRoot()).toBeNull(); // قبل الإغلاق: لا تقرير ولا أزرار
    await confirmClose(user);

    expect(await screen.findByText('Shift handed over')).toBeTruthy();
    const root = await waitFor(() => { const el = actionsRoot(); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(root.getAttribute('data-just-closed')).toBe('true');
    expect(within(root).getByText('Shift closed — its report is ready')).toBeTruthy();
    for (const action of ['preview', 'print', 'download', 'share']) expect(reportButton(action)).toBeTruthy();
    expect(backend.postsTo('/close')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Back to home' })).toBeTruthy(); // الإجراء الأساسي القائم باقٍ
    const writes = backend.posts.length;

    await waitFor(() => expect(reportButton('print').disabled).toBe(false));
    await user.click(reportButton('print'));
    await waitFor(() => expect(share.openForPrint).toHaveBeenCalledTimes(1));
    await user.click(reportButton('download'));
    await waitFor(() => expect(share.downloadBlob).toHaveBeenCalledTimes(1));
    expect(String(share.downloadBlob.mock.calls[0][1])).toMatch(/^shift-report-SH-001-a4-\d{4}-\d{2}-\d{2}\.pdf$/);
    await user.click(reportButton('share'));
    await waitFor(() => expect(share.shareBlob).toHaveBeenCalledTimes(1));
    expect(backend.posts.length).toBe(writes); // الطباعة/التنزيل/المشاركة لا تكتب شيئاً ولا تعيد الإغلاق
    expect(backend.postsTo('/close')).toHaveLength(1);
  });

  it('(11) preview opens the report from the same model (identity, sales litres, handover) inside a dialog with print + download', async () => {
    const user = userEvent.setup();
    connect(withShift(CLOSED));
    nav.pathname = '/fuel-stations/ops/shifts/s1';
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    await waitFor(() => expect(reportButton('preview')?.disabled).toBe(false));
    await user.click(reportButton('preview'));
    const dialog = await screen.findByRole('dialog', { name: 'Shift report preview' });
    const preview = dialog.querySelector('[data-shift-report-preview]') as HTMLElement;
    expect(preview.getAttribute('data-paper')).toBe('a4');
    expect(within(preview).getByText('SH-001')).toBeTruthy();
    expect(preview.querySelector('[data-report-section="readings"]')).toBeTruthy();
    expect(preview.querySelector('[data-report-section="handover"]')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: /Print report/ }));
    await waitFor(() => expect(share.openForPrint).toHaveBeenCalledTimes(1));
    expect(pdf.create).toHaveBeenCalledTimes(1);
  });
});

describe('(2) a failed or unconfirmed close never shows a closed report', () => {
  it('rejected close (422) keeps the shift open: no success card, no report actions', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()), { kind: 'afterClose', view: frozenCollection() });
    backend.fail({ match: (c) => c.path.endsWith('/close'), mode: 'reject', status: 422, message: 'سياسة المحطة تتطلب إسناد عامل واحد على الأقل قبل إغلاق الشفت.' });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await field('counted-cash'), '500');
    await confirmClose(user);
    expect(await screen.findByText("You can't hand over before at least one person is on the shift.")).toBeTruthy();
    expect(screen.queryByText('Shift handed over')).toBeNull();
    expect(actionsRoot()).toBeNull();
    expect(screen.queryByText('Shift closed — its report is ready')).toBeNull();
  });

  it('a lost reply (outcome unknown) shows NO report until "Check status" reads the shift as closed', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()), { kind: 'afterClose', view: frozenCollection() });
    backend.fail({ match: (c) => c.path.endsWith('/close'), mode: 'network_after_apply' });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await field('counted-cash'), '500');
    await confirmClose(user);
    expect(await screen.findByText(/The connection dropped after sending/)).toBeTruthy();
    expect(actionsRoot()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText('This shift has been handed over')).toBeTruthy();
    const root = await waitFor(() => { const el = actionsRoot(); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(root.getAttribute('data-just-closed')).toBe('false'); // لم نشهد الإغلاق: عنوان محايد لا «أُغلقت للتو»
    expect(backend.postsTo('/close')).toHaveLength(1);
  });
});

describe('(3) reopening a closed shift reprints without re-closing', () => {
  it('shift details of a closed/approved shift show the actions (not "just closed") and write nothing', async () => {
    for (const status of ['closed', 'approved']) {
      cleanup();
      connect(withShift({ ...CLOSED, status, approved_at: status === 'approved' ? '2026-11-03T14:00:00+00:00' : null }));
      renderOps(<ShiftDetailScreen shiftId="s1" />);
      const root = await waitFor(() => { const el = actionsRoot(); expect(el).toBeTruthy(); return el as HTMLElement; });
      expect(root.getAttribute('data-just-closed')).toBe('false');
      expect(within(root).getByText('Shift closing & handover report')).toBeTruthy();
      expect(backend.posts).toHaveLength(0);
    }
  });

  it('the handover screen of an already-closed shift also offers the report (reopening via the handover link)', async () => {
    connect(withShift(CLOSED));
    renderOps(<HandoverScreen shiftId="s1" />);
    expect(await screen.findByText('This shift has been handed over')).toBeTruthy();
    const root = await waitFor(() => { const el = actionsRoot(); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(root.getAttribute('data-just-closed')).toBe('false');
    expect(backend.posts).toHaveLength(0);
  });
});

describe('(4) an open / incomplete shift has no closing report', () => {
  it('open shift details and the handover form show no report actions', async () => {
    connect(withShift({ status: 'open', ...allReadings() }));
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    await screen.findByText('SH-001');
    expect(actionsRoot()).toBeNull();
    cleanup();
    connect(withShift({ status: 'open', ...allReadings() }));
    renderOps(<HandoverScreen shiftId="s1" />);
    await field('counted-cash');
    expect(actionsRoot()).toBeNull();
  });
});

describe('data readiness, permissions and failure honesty', () => {
  it('while the collection snapshot loads the buttons are disabled; once ready they enable', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    connect(withShift(CLOSED));
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path: string, init?: Parameters<typeof original>[1]) => {
      if (path.endsWith('/collection')) await gate;
      return original(path, init);
    });
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    const root = await waitFor(() => { const el = actionsRoot(); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(reportButton('print').disabled).toBe(true);
    expect(within(root).getByText('Loading report data…')).toBeTruthy();
    await act(async () => { release(); });
    await waitFor(() => expect(reportButton('print').disabled).toBe(false));
  });

  it('a server/network failure of the snapshot is shown as "could not load" with Retry — the report is never printed from partial data', async () => {
    const user = userEvent.setup();
    const flaky = { failing: true };
    connect(withShift(CLOSED), { kind: 'flaky', view: frozenCollection(), state: flaky });
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    const alert = await waitFor(() => { const el = document.querySelector('[data-report-load-failed]'); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(reportButton('print').disabled).toBe(true);
    flaky.failing = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(document.querySelector('[data-report-load-failed]')).toBeNull());
    await waitFor(() => expect(reportButton('print').disabled).toBe(false));
  });

  it('404/403 on the snapshot (gate closed / no permission) is "unavailable": the report still prints, declaring amounts unavailable', async () => {
    const user = userEvent.setup();
    connect(withShift(CLOSED), { kind: 'error', status: 404 });
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    await waitFor(() => expect(reportButton('preview')?.disabled).toBe(false));
    await user.click(reportButton('preview'));
    const dialog = await screen.findByRole('dialog', { name: 'Shift report preview' });
    expect(dialog.querySelector('[data-report-note="amounts-unavailable"]')).toBeTruthy();
    expect(dialog.querySelector('[data-report-section="collection"]')).toBeNull();
  });

  it('(5) a frozen snapshot with a shortage prints the server-approved difference in the preview', async () => {
    const user = userEvent.setup();
    const shortage = frozenCollection({ reconciliation: { visible: true, final: true, reason: null, collected_total_minor: 280_000, sales_minor: 283_100, difference_minor: -3_100, direction: 'shortage' } });
    connect(withShift(CLOSED), { kind: 'view', view: shortage });
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    await waitFor(() => expect(reportButton('preview')?.disabled).toBe(false));
    await user.click(reportButton('preview'));
    const dialog = await screen.findByRole('dialog', { name: 'Shift report preview' });
    const recon = dialog.querySelector('[data-report-section="reconciliation"]') as HTMLElement;
    expect(recon.textContent).toContain('31.00');
    expect(recon.textContent).toContain('Shortage');
  });

  it('(8) a viewer without sales permission: preview has no price/amount/difference', async () => {
    const user = userEvent.setup();
    const hidden = frozenCollection({
      review: { visible: false },
      sales: { ...frozenCollection().sales, visible: false, amount_minor: null, products: [{ fuel_product_id: 'p1', name: 'Alpha', nozzle_count: 1, milliliters: 100_000, gaps: [] }] },
      reconciliation: { visible: false },
    });
    connect(withShift(CLOSED), { kind: 'view', view: hidden });
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    await waitFor(() => expect(reportButton('preview')?.disabled).toBe(false));
    await user.click(reportButton('preview'));
    const dialog = await screen.findByRole('dialog', { name: 'Shift report preview' });
    expect(dialog.textContent).not.toContain('Price per litre');
    expect(dialog.textContent).not.toContain('Sales due');
    expect(dialog.textContent).not.toContain('Shortage');
    expect(dialog.querySelector('[data-report-note="sales-hidden"]')).toBeTruthy();
  });

  it('(11) a failed PDF build shows an error message and unlocks; a blocked popup is reported, nothing is silently lost', async () => {
    const user = userEvent.setup();
    connect(withShift(CLOSED));
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    await waitFor(() => expect(reportButton('print')?.disabled).toBe(false));
    pdf.create.mockRejectedValueOnce(new Error('font'));
    await user.click(reportButton('print'));
    expect((await screen.findByRole('alert')).textContent).toContain('The report could not be prepared');
    expect(reportButton('print').disabled).toBe(false);
    share.openForPrint.mockReturnValueOnce(false);
    await user.click(reportButton('print'));
    await waitFor(() => expect(document.querySelector('[data-report-message="error"]')?.textContent).toContain('blocked'));
  });

  it('double click is locked: one PDF build and one print call', async () => {
    const user = userEvent.setup();
    connect(withShift(CLOSED));
    let release!: () => void;
    pdf.create.mockImplementationOnce(() => new Promise<Blob>((resolve) => { release = () => resolve(new Blob(['x'])); }));
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    await waitFor(() => expect(reportButton('print')?.disabled).toBe(false));
    await user.click(reportButton('print'));
    await user.click(reportButton('print'));
    expect(pdf.create).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await waitFor(() => expect(share.openForPrint).toHaveBeenCalledTimes(1));
  });
});

describe('(10) paper choice and language', () => {
  it('A5 brief is selectable, remembered on this device, and used by the preview and the file name', async () => {
    const user = userEvent.setup();
    connect(withShift(CLOSED));
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    await waitFor(() => expect(reportButton('download')?.disabled).toBe(false));
    const a5 = document.querySelector('[data-paper="a5"]') as HTMLButtonElement;
    await user.click(a5);
    expect(a5.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem(SHIFT_REPORT_PAPER_KEY)).toBe('a5');
    await user.click(reportButton('preview'));
    const dialog = await screen.findByRole('dialog', { name: 'Shift report preview' });
    expect(dialog.querySelector('[data-shift-report-preview]')?.getAttribute('data-paper')).toBe('a5');
    expect(dialog.querySelector('[data-report-section="readings"]')).toBeNull(); // المختصر بلا جدول الفوهات
    await user.click(within(dialog).getByRole('button', { name: /Download PDF/ }));
    await waitFor(() => expect(share.downloadBlob).toHaveBeenCalled());
    expect(String(share.downloadBlob.mock.calls[0][1])).toMatch(/-a5-/);
  });

  it('a remembered A5 choice is applied on the next visit; blocked storage falls back to A4 without throwing', async () => {
    localStorage.setItem(SHIFT_REPORT_PAPER_KEY, 'a5');
    connect(withShift(CLOSED));
    renderOps(<ShiftDetailScreen shiftId="s1" />);
    await waitFor(() => expect((document.querySelector('[data-paper="a5"]') as HTMLElement).getAttribute('aria-checked')).toBe('true'));
  });

  it('Arabic renders the actions RTL with Arabic labels and has no axe violations (en + ar)', async () => {
    for (const locale of ['en', 'ar'] as const) {
      cleanup();
      connect(withShift(CLOSED));
      const view = renderOps(<ShiftDetailScreen shiftId="s1" />, locale);
      await waitFor(() => expect(reportButton('preview')?.disabled).toBe(false));
      if (locale === 'ar') expect(actionsRoot()?.textContent).toContain('معاينة التقرير');
      expect((await axe(view.container)).violations).toEqual([]);
    }
  });
});

describe('(13) regression: report code writes nothing and the close flow is unchanged', () => {
  it('the only POST during close + report use is the single /close with exactly the counted cash', async () => {
    const user = userEvent.setup();
    connect(withShift(allReadings()), { kind: 'afterClose', view: frozenCollection() });
    renderOps(<HandoverScreen shiftId="s1" />);
    await user.type(await field('counted-cash'), '480');
    await confirmClose(user);
    await screen.findByText('Shift handed over');
    await waitFor(() => expect(reportButton('download').disabled).toBe(false));
    await user.click(reportButton('download'));
    await waitFor(() => expect(share.downloadBlob).toHaveBeenCalled());
    expect(backend.posts.map((call) => call.path)).toEqual(['/fuel-stations/shifts/s1/close']);
    expect(backend.postsTo('/close')[0].body).toEqual({ counted_cash_minor: 48_000 });
  });
});
