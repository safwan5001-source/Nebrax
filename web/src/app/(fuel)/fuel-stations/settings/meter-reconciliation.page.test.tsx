// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES } from '@/test-utils/intl';

const STATION = '00000000-0000-4000-8000-0000000000a1';
const state = vi.hoisted(() => ({
  permissions: ['*'] as string[],
  tenant: { shift_meter_reconciliation_enabled: false, shift_meter_tolerance_milliliters: 0 } as Record<string, unknown>,
  station: { shift_meter_reconciliation_enabled: false, shift_meter_tolerance_milliliters: 0 } as Record<string, unknown>,
  deploymentOpen: true,
  overrides: [] as string[],
  forbid: false,
}));
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string; body: Record<string, unknown> | undefined }>);

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/auth', async (original) => ({ ...(await original<typeof import('@/lib/auth')>()), currentUser: () => ({ permissions: state.permissions }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string, opts: { method?: string; body?: Record<string, unknown> } = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ path, method, body: opts.body });
    const route = path.split('?')[0];
    const policy = (value: boolean) => ({ deployment_open: state.deploymentOpen, setting_enabled: value, active: state.deploymentOpen && value, source: state.overrides.length ? 'station' : 'organization' });
    if (route === '/fuel-stations/settings') {
      if (method === 'PUT') {
        if (state.forbid) throw new (await import('@/lib/api')).ApiError(403, 'forbidden-by-server', { message: 'forbidden-by-server' });
        Object.assign(state.tenant, opts.body);
        return { data: state.tenant, meta: { meter_reconciliation: { deployment_open: state.deploymentOpen } } };
      }
      return { data: state.tenant, meta: { meter_reconciliation: { deployment_open: state.deploymentOpen } } };
    }
    if (route === '/fuel-stations/stations') return { data: [{ id: STATION, name: 'المحطة أ', code: 'A1', status: 'active' }] };
    if (route === `/fuel-stations/stations/${STATION}/settings`) {
      if (method === 'PUT') {
        for (const [key, value] of Object.entries(opts.body ?? {})) {
          if (key === 'reason') continue;
          state.station[key] = value ?? state.tenant[key];
          state.overrides = value === null ? state.overrides.filter((x) => x !== key) : [...new Set([...state.overrides, key])];
        }
      }
      return { data: state.station, meta: { overrides: state.overrides, meter_reconciliation: policy(Boolean(state.station.shift_meter_reconciliation_enabled)) } };
    }
    return { data: [] };
  }),
}));

import FuelStationsSettingsPage from './page';

const T = TEST_MESSAGES.ar.fuelStationsSettings;
const M = T.meterReconciliation;
const shifts = () => document.getElementById('shifts') as HTMLElement;
const policy = () => shifts().querySelector('[data-meter-reconciliation-policy]') as HTMLElement;
const status = () => policy().querySelector('[data-meter-reconciliation-status]')?.getAttribute('data-meter-reconciliation-status');
const saveShifts = () => within(shifts()).getByRole('button', { name: T.save }) as HTMLButtonElement;
const puts = () => calls.filter((call) => call.method === 'PUT');

async function mount() {
  renderIntl(<FuelStationsSettingsPage />, 'ar');
  await waitFor(() => expect(document.getElementById('shifts')).not.toBeNull());
  await waitFor(() => expect(policy()).toBeTruthy());
}

beforeEach(() => {
  state.permissions = ['*'];
  state.tenant = { shift_meter_reconciliation_enabled: false, shift_meter_tolerance_milliliters: 0 };
  state.station = { shift_meter_reconciliation_enabled: false, shift_meter_tolerance_milliliters: 0 };
  state.deploymentOpen = true;
  state.overrides = [];
  state.forbid = false;
  calls.length = 0;
});
afterEach(cleanup);

describe('ERP fuel settings — meter reconciliation policy', () => {
  it('shows the disabled default and saves exactly one key (with the reason) through the existing settings PUT', async () => {
    await mount();
    expect(status()).toBe('disabled');
    expect(saveShifts().disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(T.changeReasonHint), { target: { value: 'تفعيل تجريبي' } });
    fireEvent.click(within(policy()).getByRole('switch'));
    expect(saveShifts().disabled).toBe(false);
    fireEvent.click(saveShifts());

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toMatchObject({ path: '/fuel-stations/settings', body: { shift_meter_reconciliation_enabled: true, reason: 'تفعيل تجريبي' } });
    await waitFor(() => expect(status()).toBe('active'));
  });

  it('keeps an enabled choice visible as «deployment closed» instead of claiming it is active', async () => {
    state.tenant.shift_meter_reconciliation_enabled = true;
    state.deploymentOpen = false;
    await mount();
    expect(status()).toBe('pending_deployment');
    expect(policy().textContent).toContain(M.status.pending_deployment.title);
  });

  it('cannot be changed without the governance permission, and a server refusal is shown as-is', async () => {
    state.permissions = ['fuel_stations.view', 'fuel_stations.manage'];
    await mount();
    expect((within(policy()).getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect(policy().textContent).toContain(M.governanceRequired);

    cleanup();
    state.permissions = ['fuel_stations.manage', 'fuel.governance.manage'];
    state.forbid = true;
    await mount();
    fireEvent.click(within(policy()).getByRole('switch'));
    fireEvent.click(saveShifts());
    await waitFor(() => expect(document.body.textContent).toContain('forbidden-by-server'));
    expect(status()).toBe('disabled');                                              // لا «نشِطة» بعد رفض الخادم: الحالة من القيمة المحفوظة
    expect(policy().querySelector('[data-meter-reconciliation-unsaved]')).not.toBeNull();
  });

  it('writes the station override to the station route and can fall back to the organization value', async () => {
    state.tenant.shift_meter_reconciliation_enabled = true;
    state.station.shift_meter_reconciliation_enabled = true;                       // ترث المحطة قيمة المؤسسة
    await mount();
    expect(status()).toBe('active');

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: STATION } });
    await waitFor(() => expect(calls.some((call) => call.path.startsWith(`/fuel-stations/stations/${STATION}/settings`))).toBe(true));
    await waitFor(() => expect(policy().querySelector('[data-meter-reconciliation-source="organization"]')).not.toBeNull());

    fireEvent.click(within(policy()).getByRole('switch'));                        // يعطّل لهذه المحطة وحدها
    fireEvent.click(saveShifts());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].path).toBe(`/fuel-stations/stations/${STATION}/settings`);
    expect(puts()[0].body).toMatchObject({ shift_meter_reconciliation_enabled: false });
    await waitFor(() => expect(policy().querySelector('[data-meter-reconciliation-source="station"]')).not.toBeNull());

    fireEvent.click(within(policy()).getByText(M.useInherited));                   // العودة لقيمة المؤسسة = مسح التجاوز
    fireEvent.click(saveShifts());
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].body).toMatchObject({ shift_meter_reconciliation_enabled: null });
  });
});
