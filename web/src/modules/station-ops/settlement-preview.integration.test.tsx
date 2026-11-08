// @vitest-environment jsdom
import * as React from 'react';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
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
import { HandoverScreen } from './handover-screen';
import type { SettlementPreview } from './settlement-preview';
import { StationOpsShell } from './shell';

const apiMock = vi.mocked(api);
const CLOSER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count', 'fuel.shift.close'];
const FINANCE = [...CLOSER, 'fuel.sale.view'];

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
      meter_readings: [meter('o', 'n1', 'opening', 100_000), meter('c', 'n1', 'closing', 120_000)],
      tank_readings: [tankReading('to', 't1', 'opening', 9_000_000), tankReading('tc', 't1', 'closing', 8_980_000)],
    }),
  };
  return d;
}

function basic(overrides: Partial<SettlementPreview> = {}): SettlementPreview {
  return {
    enabled: true, writes_nothing: true, shift: { id: 's1', number: 'SH-001', status: 'open' }, policy: { mode: 'post_on_close', sales_basis: 'per_invoice' },
    ready: true, blockers: [], preview_hash: 'f'.repeat(64), evaluated_at: '2026-11-08T10:00:00+00:00', disclaimers: ['preview_only_no_postings'],
    lines: [{ nozzle_id: 'n1', nozzle_number: '1', fuel_product_id: 'p1', metered_milliliters: 20_000, withheld: false }],
    ...overrides,
  };
}

function financeLayer(overrides: Partial<SettlementPreview> = {}): SettlementPreview {
  return basic({
    lines: [{ nozzle_id: 'n1', nozzle_number: '1', fuel_product_id: 'p1', metered_milliliters: 20_000, withheld: false, erp_milliliters: 5_000, residual_milliliters: 15_000, price_per_liter_minor: 230, expected_gross_minor: 3_450, state: 'posted', withheld_reason: null }],
    reference: { total_minor: 4_600 },
    declaration: { present: true, declared_total_minor: 4_000, difference_vs_reference_minor: -600 },
    allocation: { rows: [{ payment_method_id: 'm1', method: 'Cash', settlement_type: 'cash', target_kind: 'erp_walk_in', target_ref: 'FS-1', amount_minor: 1_150 }, { payment_method_id: 'm1', method: 'Cash', settlement_type: 'cash', target_kind: 'settlement', target_ref: 'nozzle:1', amount_minor: 2_850 }], allocated_total_minor: 4_000 },
    variances: { shortage_minor: 600, surplus: [], held_for_withheld: [] },
    ...overrides,
  });
}

let previewHandler: () => unknown;
function connect(permissions: string[], handler: () => unknown): void {
  seedUser(permissions);
  previewHandler = handler;
  const backend = createWriteBackend(data());
  apiMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path === '/me') return { user: JSON.parse(localStorage.getItem('user') as string) };
    if (path.endsWith('/settlement-preview')) return { data: previewHandler() } as never;
    if (path.endsWith('/collection')) throw new ApiError(404, 'not found', {});
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
const previewCalls = () => apiMock.mock.calls.filter(([p]) => String(p).endsWith('/settlement-preview'));

describe('settlement preview on the handover screen', () => {
  it('gate closed (404): nothing is rendered and the handover screen is exactly as before', async () => {
    connect(CLOSER, () => { throw new ApiError(404, 'not found', {}); });
    renderOps(<HandoverScreen shiftId="s1" />);
    expect(await screen.findByText('Every required reading is recorded.')).toBeTruthy();
    await waitFor(() => expect(previewCalls().length).toBeGreaterThan(0));
    expect(screen.queryByText('Settlement preview')).toBeNull();
    expect(document.querySelector('[data-settlement-preview]')).toBeNull();
  });

  it('without the close permission no request is even sent', async () => {
    connect(['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.cash_count'], () => basic());
    renderOps(<HandoverScreen shiftId="s1" />);
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => String(p) === '/fuel-stations/shifts/s1')).toBe(true));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(previewCalls()).toHaveLength(0);
    expect(document.querySelector('[data-settlement-preview]')).toBeNull();
  });

  it('a closer without sales access sees readiness, blockers and liters — and no amounts', async () => {
    connect(CLOSER, () => basic({ ready: false, blockers: ['FUEL_SETTLEMENT_DECLARATION_MISSING', 'FUEL_SETTLEMENT_SUPERVISOR_ATTENTION'] }));
    renderOps(<HandoverScreen shiftId="s1" />);
    expect(await screen.findByText('Settlement preview')).toBeTruthy();
    expect(document.querySelector('[data-settlement-status]')?.getAttribute('data-settlement-status')).toBe('blocked');
    expect(screen.getByText('The collection declaration is not saved yet.')).toBeTruthy();
    expect(screen.getByText('Needs supervisor review before settlement.')).toBeTruthy();
    expect(document.querySelector('[data-settlement-lines]')?.textContent).toContain('20.000');
    expect(document.querySelector('[data-settlement-reference]')).toBeNull();
    expect(document.querySelector('[data-settlement-allocation]')).toBeNull();
    expect(document.querySelector('[data-settlement-hidden]')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\b230\b|34\.50/);
  });

  it('a sales viewer sees expected values, the declaration check (short) and how the money is applied', async () => {
    connect(FINANCE, () => financeLayer());
    renderOps(<HandoverScreen shiftId="s1" />);
    expect(await screen.findByText('Settlement preview')).toBeTruthy();
    const line = document.querySelector('[data-settlement-line="n1"]') as HTMLElement;
    expect(line.textContent).toContain('34.50');
    expect(line.querySelector('[data-settlement-state]')?.getAttribute('data-settlement-state')).toBe('posted');
    expect(document.querySelector('[data-settlement-direction]')?.getAttribute('data-settlement-direction')).toBe('short');
    expect(document.querySelector('[data-settlement-reference]')?.textContent).toContain('46.00');
    expect(document.querySelector('[data-settlement-reference]')?.textContent).toContain('40.00');
    const allocation = document.querySelector('[data-settlement-allocation]') as HTMLElement;
    expect(allocation.textContent).toContain('Pays an earlier recorded sale');
    expect(allocation.textContent).toContain('Pays the rest of the shift');
    expect(document.querySelector('[data-settlement-shortage]')?.textContent).toContain('6.00');
    expect(document.querySelector('[data-settlement-hidden]')).toBeNull();
  });

  it('shows deferred lines and surplus / held amounts without calling them a surplus when held', async () => {
    connect(FINANCE, () => financeLayer({
      lines: [{ nozzle_id: 'n1', nozzle_number: '1', fuel_product_id: 'p1', metered_milliliters: 20_000, withheld: true, erp_milliliters: 0, residual_milliliters: 20_000, expected_gross_minor: 4_600, state: 'withheld_cost_pool_changed', withheld_reason: 'withheld_cost_pool_changed' }],
      allocation: { rows: [], allocated_total_minor: 0 },
      variances: { shortage_minor: 0, surplus: [], held_for_withheld: [{ payment_method_id: 'm1', method: 'Cash', amount_minor: 4_600 }] },
      declaration: { present: true, declared_total_minor: 4_600, difference_vs_reference_minor: 0 },
      reference: { total_minor: 4_600 },
    }));
    renderOps(<HandoverScreen shiftId="s1" />);
    await screen.findByText('Settlement preview');
    expect(document.querySelector('[data-settlement-state]')?.textContent).toContain('Deferred: stock cost changed');
    expect(document.querySelector('[data-settlement-held]')?.textContent).toContain('46.00');
    expect(document.querySelector('[data-settlement-surplus]')).toBeNull();
    expect(document.querySelector('[data-settlement-direction]')?.getAttribute('data-settlement-direction')).toBe('match');
  });

  it('an unknown server code never leaks raw text; refresh re-reads the server and nothing is ever written', async () => {
    const user = userEvent.setup();
    let calls = 0;
    connect(FINANCE, () => { calls += 1; return financeLayer({ ready: false, blockers: calls === 1 ? ['FUEL_SETTLEMENT_SOMETHING_NEW'] : [] }); });
    renderOps(<HandoverScreen shiftId="s1" />);
    expect(await screen.findByText('Unknown reason.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('SOMETHING_NEW');

    await act(async () => { await user.click(document.querySelector('[data-settlement-refresh]') as HTMLButtonElement); });
    await waitFor(() => expect(screen.queryByText('Unknown reason.')).toBeNull());
    expect(previewCalls().length).toBe(2);
    // لا أي كتابة من قسم المعاينة: كل نداءاته GET (لا method أصلاً) ولا مسار POST إلى settlement.
    for (const [path, init] of previewCalls()) {
      expect(String(path)).toMatch(/\/settlement-preview$/);
      expect((init as { method?: string } | undefined)?.method ?? 'GET').toBe('GET');
    }
    expect(apiMock.mock.calls.some(([p, init]) => /settlement/.test(String(p)) && (init as { method?: string } | undefined)?.method === 'POST')).toBe(false);
  });

  it('a network failure shows a calm message, not a stack of blockers', async () => {
    connect(CLOSER, () => { throw new TypeError('network'); });
    renderOps(<HandoverScreen shiftId="s1" />);
    expect(await screen.findByText('The preview could not be loaded right now.')).toBeTruthy();
    expect(document.querySelector('[data-settlement-blockers]')).toBeNull();
  });

  it('renders in Arabic RTL with ASCII digits only and no accessibility violations', async () => {
    connect(FINANCE, () => financeLayer());
    const { container } = renderOps(<HandoverScreen shiftId="s1" />, 'ar');
    expect(await screen.findByText('معاينة التسوية')).toBeTruthy();
    const text = document.querySelector('[data-settlement-preview]')?.textContent ?? '';
    expect(text).not.toMatch(/[٠-٩]/);
    expect(text).toMatch(/34\.50|34,50/);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
