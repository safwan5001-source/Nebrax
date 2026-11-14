// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';

const ids = vi.hoisted(() => ({ ST1: '00000000-0000-4000-8000-0000000000a1', A1: 'acc-1145', A2: 'acc-1146', LIAB: 'acc-2110', GRP: 'acc-11', OFF: 'acc-1199' }));
const { ST1, A1, A2 } = ids;
const state = vi.hoisted(() => ({
  tenant: {} as Record<string, unknown>,
  station: {} as Record<string, unknown>,
  overrides: [] as string[],
  evaluation: { configured: false, valid: false, reason: null as string | null, account: null as Record<string, unknown> | null },
  blockers: ['clearing_account_missing'] as string[],
  notices: ['posting_start_not_set', 'posting_gate_closed'] as string[],
  fail: {} as Record<string, { status: number; message?: string }>,
}));
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string; body: unknown }>);
const toast = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: toast, error: vi.fn() }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ path, method, body: opts.body });
    const failing = state.fail[`${method} ${path.split('?')[0]}`];
    if (failing) throw new (await import('@/lib/api')).ApiError(failing.status, failing.message ?? 'x', { message: failing.message ?? 'x' });
    const route = path.split('?')[0];
    if (route === '/fuel-stations/settings' && method === 'GET') return { data: state.tenant };
    if (route === '/fuel-stations/settings' && method === 'PUT') { Object.assign(state.tenant, opts.body); return { data: state.tenant }; }
    if (/^\/fuel-stations\/stations\/[0-9a-f-]{36}\/settings$/.test(route)) {
      if (method === 'PUT') {
        for (const [key, value] of Object.entries(opts.body as Record<string, unknown>)) {
          if (key === 'reason') continue;
          state.station[key] = value ?? state.tenant[key];
          state.overrides = value === null ? state.overrides.filter((x) => x !== key) : [...new Set([...state.overrides, key])];
        }
      }
      return { data: state.station, meta: { overrides: state.overrides } };
    }
    if (route === '/fuel-stations/tanker-fills/inventory-settings') {
      return { data: { clearing_account: state.evaluation, blockers: state.blockers, notices: state.notices, cost_recognition: 'clearing_until_invoice' }, meta: { read_only: true, posting_enabled: false, posting_gate_open: false } };
    }
    if (route === '/accounts') {
      return { data: [
        { id: A2, code: '1146', name: 'وسيط ثانٍ', type: 'asset', is_active: true, is_group: false },
        { id: A1, code: '1145', name: 'وقود لدى أصحاب الصهاريج', type: 'asset', is_active: true, is_group: false },
        { id: ids.LIAB, code: '2110', name: 'الموردون', type: 'liability', is_active: true, is_group: false },
        { id: ids.GRP, code: '11', name: 'أصول متداولة', type: 'asset', is_active: true, is_group: true },
        { id: ids.OFF, code: '1199', name: 'معطّل', type: 'asset', is_active: false, is_group: false },
      ] };
    }
    return { data: {} };
  }),
}));

import { InventorySettingsCard } from './inventory-settings-card';

const T = (locale: TestLocale) => TEST_MESSAGES[locale].fuelTankers.inventorySettings;
const writes = () => calls.filter((call) => call.method !== 'GET');
const FULL = ['*'];
const VIEW_ONLY = ['fuel.tanker.fill.inventory.view', 'fuel_stations.view'];

beforeEach(() => {
  calls.length = 0;
  toast.mockClear();
  state.tenant = { operating_timezone: 'Asia/Riyadh', tanker_issue_clearing_account_id: null, tanker_cost_recognition: 'clearing_until_invoice', fuel_pool_ledger_variance_policy: 'block', tanker_inventory_posting_start_at: null, tanker_inventory_alerts_enabled: true };
  state.station = { ...state.tenant };
  state.overrides = [];
  state.evaluation = { configured: false, valid: false, reason: null, account: null };
  state.blockers = ['clearing_account_missing'];
  state.notices = ['posting_start_not_set', 'posting_gate_closed'];
  state.fail = {};
});
afterEach(cleanup);

function renderCard(options: { permissions?: string[] | null; stationId?: string; manage?: boolean; govern?: boolean; locale?: TestLocale } = {}) {
  const { permissions = FULL, stationId = '', manage = true, govern = true, locale = 'ar' } = options;
  return renderIntl(<InventorySettingsCard stationId={stationId} permissions={permissions} canManage={manage} canGovern={govern} />, locale);
}

describe('InventorySettingsCard', () => {
  it('without the inventory view permission shows only a note and makes no request', () => {
    renderCard({ permissions: ['fuel_stations.view'] });
    expect(document.querySelector('[data-inventory-settings-denied]')?.textContent).toContain('fuel.tanker.fill.inventory.view');
    expect(calls).toHaveLength(0);
  });

  it('loads read-only: shows the missing-account blocker, the closed gate note and the defaults, and writes nothing', async () => {
    renderCard();
    await waitFor(() => expect(document.querySelector('[data-inventory-settings]')).not.toBeNull());
    const t = T('ar');
    expect(screen.getByText(t.blocker.clearing_account_missing)).toBeTruthy();
    expect(document.querySelector('[data-inventory-settings-gate]')?.textContent).toBe(t.gateClosedNote);
    expect(screen.getByText(t.notice.posting_start_not_set)).toBeTruthy();
    expect((screen.getByLabelText(t.variance.label) as HTMLSelectElement).value).toBe('block');
    expect(writes()).toHaveLength(0);
    // لا اختيار افتراضي صامت للحساب.
    expect((screen.getByLabelText(t.clearing.label) as HTMLSelectElement).value).toBe('');
  });

  it('offers only active non-group asset accounts and saves the explicit choice with the reason, then re-reads from the server', async () => {
    renderCard();
    await screen.findByLabelText(T('ar').clearing.label);
    const select = screen.getByLabelText(T('ar').clearing.label) as HTMLSelectElement;
    const labels = [...select.options].map((option) => option.textContent);
    expect(labels).toEqual([T('ar').clearing.none, '1145 — وقود لدى أصحاب الصهاريج', '1146 — وسيط ثانٍ']);

    fireEvent.change(select, { target: { value: A1 } });
    fireEvent.change(screen.getByLabelText(T('ar').reasonLabel), { target: { value: 'تعيين الوسيط' } });
    fireEvent.click(screen.getByRole('button', { name: T('ar').save }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ path: '/fuel-stations/settings', method: 'PUT', body: { tanker_issue_clearing_account_id: A1, reason: 'تعيين الوسيط' } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(T('ar').saved));
    expect(JSON.stringify(writes()[0].body)).not.toMatch(/tenant_id/);
  });

  it('shows the server rejection reason localized (not the raw server text) and keeps the previous value', async () => {
    state.fail['PUT /fuel-stations/settings'] = { status: 422, message: 'FUEL_TANKER_CLEARING_ACCOUNT_INVALID:inventory_account: لا يجوز أن يكون الحساب الوسيط حساب مخزون.' };
    renderCard();
    const select = (await screen.findByLabelText(T('ar').clearing.label)) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: A2 } });
    fireEvent.click(screen.getByRole('button', { name: T('ar').save }));
    await waitFor(() => expect(document.querySelector('[data-inventory-settings-rejection]')).not.toBeNull());
    expect(document.querySelector('[data-inventory-settings-rejection]')?.textContent).toBe(T('ar').reason.inventory_account);
    expect(state.tenant.tanker_issue_clearing_account_id).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it('without governance only the alerts toggle is editable and it saves with manage alone', async () => {
    renderCard({ permissions: ['fuel.tanker.fill.inventory.view', 'fuel_stations.manage', 'accounts.view'], govern: false });
    const t = T('ar');
    await screen.findByLabelText(t.clearing.label);
    expect((screen.getByLabelText(t.clearing.label) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText(t.variance.label) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText(t.cost.label) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText(t.alerts.label) as HTMLSelectElement).disabled).toBe(false);
    expect(screen.getByText(/fuel\.governance\.manage/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(t.alerts.label), { target: { value: 'false' } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ tanker_inventory_alerts_enabled: false });
  });

  it('view-only managers cannot save anything', async () => {
    renderCard({ permissions: VIEW_ONLY, manage: false, govern: false });
    const t = T('ar');
    await screen.findByLabelText(t.clearing.label);
    expect((screen.getByLabelText(t.alerts.label) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: t.save }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('without accounts.view the account stays hidden and cannot be changed', async () => {
    state.tenant.tanker_issue_clearing_account_id = A1;
    state.evaluation = { configured: true, valid: true, reason: null, account: null };
    state.blockers = [];
    renderCard({ permissions: ['fuel.tanker.fill.inventory.view', 'fuel_stations.manage', 'fuel.governance.manage'] });
    const t = T('ar');
    const select = (await screen.findByLabelText(t.clearing.label)) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect([...select.options].map((o) => o.textContent)).toContain(t.clearing.assignedHidden);
    expect(screen.getByText(/accounts\.view/)).toBeTruthy();
    expect(calls.some((call) => call.path === '/accounts')).toBe(false);
  });

  it('shows the invalid-account blocker with its reason when the assigned account stopped being valid', async () => {
    state.tenant.tanker_issue_clearing_account_id = A1;
    state.evaluation = { configured: true, valid: false, reason: 'inactive', account: { id: A1, code: '1145', name: 'وقود لدى أصحاب الصهاريج' } };
    state.blockers = ['clearing_account_invalid'];
    renderCard();
    const t = T('ar');
    await screen.findByLabelText(t.clearing.label);
    expect(screen.getByText(t.blocker.clearing_account_invalid)).toBeTruthy();
    expect(document.querySelector('[data-inventory-settings-reason]')?.textContent).toBe(t.reason.inactive);
  });

  it('station scope offers inheritance and clears a station override with null', async () => {
    state.tenant.fuel_pool_ledger_variance_policy = 'warn';
    state.station = { ...state.tenant, fuel_pool_ledger_variance_policy: 'block' };
    state.overrides = ['fuel_pool_ledger_variance_policy'];
    renderCard({ stationId: ST1 });
    const t = T('ar');
    const variance = (await screen.findByLabelText(t.variance.label)) as HTMLSelectElement;
    expect(variance.value).toBe('block');
    expect(within(variance).getAllByRole('option')[0].textContent).toContain(t.variance.option.warn);
    fireEvent.change(variance, { target: { value: 'inherit' } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: 'PUT', body: { fuel_pool_ledger_variance_policy: null } });
    expect(writes()[0].path).toContain(`/fuel-stations/stations/${ST1}/settings`);
  });

  it('converts the posting start from the organization timezone and refuses an invalid date', async () => {
    renderCard();
    const t = T('ar');
    await screen.findByLabelText(t.clearing.label);
    fireEvent.click(document.querySelector('[data-inventory-settings-advanced] summary') as HTMLElement);
    const start = document.getElementById('inv-settings-start') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-12-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ tanker_inventory_posting_start_at: '2026-11-30T21:00:00.000Z' });
  });

  it('renders in English and never shows a monetary amount', async () => {
    renderCard({ locale: 'en' });
    const t = T('en');
    await screen.findByLabelText(t.clearing.label);
    expect(screen.getByText(t.blocker.clearing_account_missing)).toBeTruthy();
    expect(document.querySelector('[data-inventory-settings]')?.textContent).not.toMatch(/ر\.س|SAR|\d+\.\d{2}/);
  });

  it('a failed load shows a retry state and nothing else', async () => {
    state.fail['GET /fuel-stations/tanker-fills/inventory-settings'] = { status: 500 };
    renderCard();
    await waitFor(() => expect(screen.getByText(T('ar').loadFailed)).toBeTruthy());
    expect(document.querySelector('[data-inventory-settings]')).toBeNull();
  });

  it('a 404 (gate closed) shows an unavailable note', async () => {
    state.fail['GET /fuel-stations/tanker-fills/inventory-settings'] = { status: 404 };
    renderCard();
    await waitFor(() => expect(document.querySelector('[data-inventory-settings-unavailable]')).not.toBeNull());
  });
});
