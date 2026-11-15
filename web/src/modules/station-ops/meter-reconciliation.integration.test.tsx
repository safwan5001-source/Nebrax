// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/fuel-stations/ops/shifts/s1/review',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { ApiError, api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import { nozzle, product, pump, shift as makeShift, shiftDetail, station, tank } from './__fixtures__';
import type { TenantData } from './__test-harness';
import { createWriteBackend } from './__write-backend';
import { MeterReconciliationSection } from './meter-reconciliation-section';
import type { MeterNozzle, MeterReconciliation } from './meter-reconciliation';
import { StationOpsShell } from './shell';
import { StationGate } from './station-gate';

const apiMock = vi.mocked(api);
const VIEWER = ['fuel_stations.view', 'fuel.shift.view'];
const REVIEWER = [...VIEWER, 'fuel.shift.meter_variance_review'];

function seedUser(permissions: string[]): void {
  const user: AuthUser = { id: 'u1', name: 'Sami Supervisor', email: 's@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
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
    shifts: [makeShift('s1', 'a', { number: 'SH-001', status: 'closed' })],
  };
  d.details = { s1: shiftDetail('s1', 'a', { number: 'SH-001', status: 'closed' }) };
  return d;
}

function row(overrides: Partial<MeterNozzle> = {}): MeterNozzle {
  return {
    id: 'r1', nozzle_id: 'n1', nozzle_number: '1', fuel_product_id: 'p1', metered_milliliters: 20_000, direct_sale_milliliters: 5_000, tanker_fill_milliliters: 5_000, tanker_fill_count: 2,
    draft_sale_milliliters: 0, unexplained_milliliters: 10_000, tolerance_milliliters: 0, status: 'variance', incompleteness: null, requires_review: true, review: null, frozen: true, ...overrides,
  };
}

function view(overrides: Partial<MeterReconciliation> = {}, nozzles: MeterNozzle[] = [row()]): MeterReconciliation {
  const pending = nozzles.filter((n) => n.requires_review && n.review === null).length;
  return {
    shift_id: 's1', frozen: true, nozzles,
    totals: { metered_milliliters: 20_000, direct_sale_milliliters: 5_000, tanker_fill_milliliters: 5_000, unexplained_milliliters: 10_000 },
    summary: { variance_nozzles: nozzles.filter((n) => n.status === 'variance').length, incomplete_nozzles: 0, pending_review: pending, review_complete: pending === 0 },
    tolerance_milliliters: 0, can_review: true,
    review_classifications: { surplus: ['unrecorded_direct_sale', 'unrecorded_tanker_fill', 'reading_error', 'calibration_test', 'internal_use', 'loss_or_leak', 'other'], over_recorded: ['over_recorded_entry', 'reading_error', 'other'], incomplete: ['reading_error', 'other'] },
    ...overrides,
  };
}

let current: () => unknown;
let reviewHandler: (body: Record<string, unknown>) => unknown;
function connect(permissions: string[], handler: () => unknown): void {
  seedUser(permissions);
  current = handler;
  const backend = createWriteBackend(data());
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
    if (path.endsWith('/meter-reconciliation/review')) return { data: reviewHandler(init?.body as Record<string, unknown>) } as never;
    if (path.endsWith('/meter-reconciliation')) return { data: current() } as never;
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

const mount = (locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell><StationGate>{(s) => <MeterReconciliationSection station={s} shiftId="s1" />}</StationGate></StationOpsShell>, locale);
const reconCalls = () => apiMock.mock.calls.filter(([p]) => String(p).endsWith('/meter-reconciliation'));
const reviewCalls = () => apiMock.mock.calls.filter(([p]) => String(p).endsWith('/meter-reconciliation/review'));

describe('meter reconciliation section', () => {
  it('gate closed (404): nothing is rendered', async () => {
    connect(VIEWER, () => { throw new ApiError(404, 'not found', {}); });
    mount();
    await waitFor(() => expect(reconCalls().length).toBeGreaterThan(0));
    expect(document.querySelector('[data-meter-recon]')).toBeNull();
    expect(screen.queryByText('Meter reconciliation')).toBeNull();
  });

  it('without view permission no request is sent', async () => {
    connect(['fuel_stations.view'], () => view());
    mount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reconCalls()).toHaveLength(0);
    expect(document.querySelector('[data-meter-recon]')).toBeNull();
  });

  it('shows meter, direct, tanker and unexplained liters from the server and says a tanker fill is not a sale', async () => {
    connect(VIEWER, () => view({ can_review: false }));
    mount();
    expect(await screen.findByText('Meter reconciliation')).toBeTruthy();
    expect(screen.getByText(/never counted as cash or card/)).toBeTruthy();
    expect(document.querySelector('[data-meter-tanker]')?.textContent).toContain('5.000');
    expect(document.querySelector('[data-meter-unexplained]')?.textContent).toContain('10.000');
    expect(document.querySelector('[data-meter-status]')?.getAttribute('data-meter-status')).toBe('variance');
    expect(screen.getByText('Liters dispensed with no record')).toBeTruthy();
    expect(screen.getByText(/2 voucher/)).toBeTruthy();
    // بلا صلاحية المراجعة: لا نموذج ولا زر، ونص صريح.
    expect(document.querySelector('[data-meter-review-form]')).toBeNull();
    expect(document.querySelector('[data-meter-no-permission]')).not.toBeNull();
  });

  it('a reviewer classifies a difference; the request carries only nozzle, classification and note, and the screen refreshes from the server', async () => {
    let state = view();
    connect(REVIEWER, () => state);
    reviewHandler = (body) => {
      state = view({}, [row({ review: { classification: String(body.classification), note: (body.note as string) ?? null, reviewed_by: 'u1', reviewed_at: '2026-11-14T10:00:00Z' } })]);
      return state;
    };
    mount();
    await screen.findByText('Supervisor review');
    const submit = document.querySelector('[data-meter-review-submit]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await userEvent.selectOptions(document.querySelector('[data-meter-class-select]') as HTMLSelectElement, 'unrecorded_direct_sale');
    expect(submit.disabled).toBe(false);
    await userEvent.click(submit);
    await waitFor(() => expect(reviewCalls()).toHaveLength(1));
    const body = reviewCalls()[0][1]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['classification', 'nozzle_id']);
    expect(body).toMatchObject({ nozzle_id: 'n1', classification: 'unrecorded_direct_sale' });
    await waitFor(() => expect(document.querySelector('[data-meter-reviewed]')).not.toBeNull());
    expect(screen.getByText('A sale that was not recorded')).toBeTruthy();
    expect(document.querySelector('[data-meter-review-form]')).toBeNull();
  });

  it('PR8-S: the additive settings policy block does not disturb the section, and a disabled setting does not hide a frozen requirement from the supervisor', async () => {
    const withPolicy = view({}, [row()]) as MeterReconciliation & { policy: unknown };
    withPolicy.policy = { deployment_open: false, setting_enabled: false, active: false, source: 'organization', review_requirement: 'required_before_approval', approval_blocked: true };
    connect(REVIEWER, () => withPolicy);
    mount();
    expect(await screen.findByText('Supervisor review')).toBeTruthy();       // التعطيل/إغلاق البوابة لا يُخفيان مسار المراجعة لمن يملك الصلاحية
    expect(document.querySelector('[data-meter-review-form]')).not.toBeNull();
    expect(document.querySelector('[data-meter-status]')?.getAttribute('data-meter-status')).toBe('variance');
  });

  it('PR8-S staff switching: the review form follows the signed-in user, never a stale session (supervisor → attendant → supervisor)', async () => {
    const asServer = (permissions: string[]) => view({ can_review: permissions.includes('fuel.shift.meter_variance_review') });
    connect(REVIEWER, () => asServer(REVIEWER));
    const first = mount();
    await screen.findByText('Supervisor review');
    expect(document.querySelector('[data-meter-review-form]')).not.toBeNull();
    first.unmount();

    // الموظف التالي على الجهاز نفسه: لا صلاحية مراجعة ⇒ الخادم يعيد can_review=false ⇒ لا نموذج ولا زر، ونص صريح.
    connect(VIEWER, () => asServer(VIEWER));
    const second = mount();
    await screen.findByText('Meter reconciliation');
    await waitFor(() => expect(document.querySelector('[data-meter-no-permission]')).not.toBeNull());
    expect(document.querySelector('[data-meter-review-form]')).toBeNull();
    expect(reviewCalls()).toHaveLength(0);
    second.unmount();

    connect(REVIEWER, () => asServer(REVIEWER));
    mount();
    await screen.findByText('Supervisor review');
    expect(document.querySelector('[data-meter-review-form]')).not.toBeNull();
  });

  it('“Other” requires a note before the button enables', async () => {
    connect(REVIEWER, () => view());
    reviewHandler = () => view();
    mount();
    await screen.findByText('Supervisor review');
    await userEvent.selectOptions(document.querySelector('[data-meter-class-select]') as HTMLSelectElement, 'other');
    expect((document.querySelector('[data-meter-review-submit]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-meter-note-required]')).not.toBeNull();
    await userEvent.type(document.querySelector('[data-meter-note]') as HTMLTextAreaElement, 'calibration drain');
    expect((document.querySelector('[data-meter-review-submit]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers only the classifications that fit an over-recorded difference', async () => {
    connect(REVIEWER, () => view({}, [row({ unexplained_milliliters: -5_000 })]));
    mount();
    await screen.findByText('Supervisor review');
    const values = Array.from((document.querySelector('[data-meter-class-select]') as HTMLSelectElement).options).map((o) => o.value).filter(Boolean);
    expect(values).toEqual(['over_recorded_entry', 'reading_error', 'other']);
    expect(screen.getByText('Recorded liters exceed the meter')).toBeTruthy();
  });

  it('a rejection is shown honestly, never resent automatically, and the state is re-read from the server', async () => {
    connect(REVIEWER, () => view());
    reviewHandler = () => { throw new ApiError(422, 'METER_VARIANCE_ALREADY_REVIEWED: x', { message: 'METER_VARIANCE_ALREADY_REVIEWED: x' }); };
    mount();
    await screen.findByText('Supervisor review');
    await userEvent.selectOptions(document.querySelector('[data-meter-class-select]') as HTMLSelectElement, 'reading_error');
    const before = reconCalls().length;
    await userEvent.click(document.querySelector('[data-meter-review-submit]') as HTMLButtonElement);
    expect(await screen.findByText('This difference was already classified. Refresh the page.')).toBeTruthy();
    expect(reviewCalls()).toHaveLength(1);
    await waitFor(() => expect(reconCalls().length).toBeGreaterThan(before));
  });

  it('a balanced shift shows a clear all-matched state with no review form', async () => {
    connect(REVIEWER, () => view({}, [row({ status: 'balanced', unexplained_milliliters: 0, requires_review: false })]));
    mount();
    expect(await screen.findByText('All nozzles match.')).toBeTruthy();
    expect(document.querySelector('[data-meter-review-form]')).toBeNull();
  });

  it('live (not frozen) figures before closing never offer a review', async () => {
    connect(REVIEWER, () => view({ frozen: false, can_review: false }, [row({ frozen: false })]));
    mount();
    expect(await screen.findByText('Live figures. They are frozen when the shift is closed.')).toBeTruthy();
    expect(document.querySelector('[data-meter-review-form]')).toBeNull();
  });

  it('a live result with a variance is never summarised as all-matched', async () => {
    connect(REVIEWER, () => view({ frozen: false, can_review: false, summary: { variance_nozzles: 1, incomplete_nozzles: 0, pending_review: 0, review_complete: false } }, [row({ frozen: false })]));
    mount();
    expect(await screen.findByText('Differences found on 1 nozzle(s). They will need a supervisor review after the shift is closed.')).toBeTruthy();
    expect(screen.queryByText('All nozzles match.')).toBeNull();
    expect(document.querySelector('[data-meter-recon-summary]')?.getAttribute('data-meter-recon-summary')).toBe('live_differences');
  });

  it('a live result with a missing reading is also flagged, not all-matched', async () => {
    connect(REVIEWER, () => view({ frozen: false, can_review: false, summary: { variance_nozzles: 0, incomplete_nozzles: 1, pending_review: 0, review_complete: false } }, [row({ frozen: false, status: 'incomplete', unexplained_milliliters: null, metered_milliliters: null, incompleteness: 'missing_reading' })]));
    mount();
    await screen.findByText('Meter reconciliation');
    expect(document.querySelector('[data-meter-recon-summary]')?.getAttribute('data-meter-recon-summary')).toBe('live_differences');
  });

  it('renders in Arabic (RTL) without accounting jargon and passes an accessibility scan', async () => {
    connect(REVIEWER, () => view());
    reviewHandler = () => view();
    const { container } = mount('ar');
    expect(await screen.findByText('مطابقة العدّادات')).toBeTruthy();
    expect(screen.getByText('تعبئة صهاريج')).toBeTruthy();
    expect(container.textContent ?? '').not.toMatch(/قيد|فاتورة|مدين|دائن|محاسب/);
    expect((await axe(container)).violations).toEqual([]);
  });
});
