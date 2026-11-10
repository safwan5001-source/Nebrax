// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import { page } from './__fixtures__';

const ids = vi.hoisted(() => ({ ST1: '00000000-0000-4000-8000-0000000000a1', ST2: '00000000-0000-4000-8000-0000000000a2' }));
const { ST1, ST2 } = ids;
const state = vi.hoisted(() => ({
  permissions: ['*'] as string[],
  fail: {} as Record<string, number>,
  tenant: {} as Record<string, unknown>,
  station: {} as Record<string, unknown>,
  overrides: [] as string[],
  holds: [] as Array<Promise<void>>,
  saveHold: null as Promise<void> | null,
  nozzles: [] as Array<Record<string, unknown>>,
}));
const toast = vi.hoisted(() => vi.fn());
const calls = vi.hoisted(() => [] as Array<{ path: string; method: string; body: unknown }>);

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: toast, error: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ permissions: state.permissions }) }));
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    const method = opts.method ?? 'GET';
    calls.push({ path, method, body: opts.body });
    const failing = state.fail[`${method} ${path.split('?')[0]}`];
    if (failing) throw new (await import('@/lib/api')).ApiError(failing, 'x', { message: failing === 422 ? 'سبب من الخادم' : 'x' });
    if (path === '/fuel-stations/tanker-owners') return page([]);
    if (path === '/fuel-stations/stations') return { data: [{ id: ST1, name: 'محطة أ', code: 'A', status: 'active' }, { id: ST2, name: 'محطة ب', code: 'B', status: 'active' }] };
    if (path === '/fuel-stations/settings' && method === 'GET') return { data: state.tenant };
    if (path === '/fuel-stations/settings' && method === 'PUT') { Object.assign(state.tenant, opts.body); return { data: state.tenant }; }
    if (/^\/fuel-stations\/stations\/[0-9a-f-]{36}\/settings$/.test(path.split('?')[0])) {
      if (method === 'PUT') {
        if (state.saveHold) await state.saveHold;
        for (const [k, v] of Object.entries(opts.body as Record<string, unknown>)) {
          if (k === 'reason') continue;
          state.station[k] = v ?? state.tenant[k];
          state.overrides = v === null ? state.overrides.filter((x) => x !== k) : [...new Set([...state.overrides, k])];
        }
      }
      return { data: state.station, meta: { overrides: state.overrides } };
    }
    if (path === '/fuel-stations/nozzles') { const hold = state.holds.shift(); if (hold) await hold; return { data: state.nozzles }; }
    const put = /^\/fuel-stations\/nozzles\/([0-9a-f-]{36})$/.exec(path);
    if (put && method === 'PUT') {
      const row = state.nozzles.find((n) => n.id === put[1])!;
      row.allowed_operations = (opts.body as { allowed_operations: unknown }).allowed_operations;
      return { data: row };
    }
    return { data: {} };
  }),
}));

import { TankerSettingsScreen } from './settings-screen';

const N1 = '00000000-0000-4000-8000-0000000000b1';
const N2 = '00000000-0000-4000-8000-0000000000b2';
const T = (locale: TestLocale) => TEST_MESSAGES[locale].fuelTankers;
const writes = () => calls.filter((c) => c.method !== 'GET');
const GOV = ['fuel.tanker.view', 'fuel_stations.view', 'fuel_stations.manage', 'fuel.governance.manage'];

beforeEach(() => {
  calls.length = 0;
  state.permissions = ['*'];
  state.fail = {};
  state.tenant = { tanker_selection_required: false, tanker_voucher_unique_scope: 'station', tanker_capacity_overrun_policy: 'allow_with_confirmation' };
  state.station = { ...state.tenant };
  state.overrides = [];
  state.holds = [];
  state.saveHold = null;
  state.nozzles = [
    { id: N1, fuel_station_id: ST1, nozzle_number: '1', pump: { pump_number: '1' }, fuel_product: { name: 'ديزل' }, status: 'active', allowed_operations: null },
    { id: N2, fuel_station_id: ST1, nozzle_number: '2', pump: { pump_number: '1' }, fuel_product: { name: 'بنزين' }, status: 'active', allowed_operations: ['tanker_fill'] },
    { id: '00000000-0000-4000-8000-0000000000b3', fuel_station_id: 'other-station', nozzle_number: '9', pump: { pump_number: '9' }, fuel_product: { name: 'ديزل' }, status: 'active', allowed_operations: null },
  ];
});
afterEach(() => { cleanup(); toast.mockReset(); });

const select = (id: string) => document.getElementById(id) as HTMLSelectElement;

describe.each(['ar', 'en'] as const)('TankerSettingsScreen (%s)', (locale) => {
  it('shows the owner-approved defaults and the fixed voucher rules', async () => {
    renderIntl(<TankerSettingsScreen />, locale);
    expect(await screen.findByRole('heading', { name: T(locale).settings.title })).toBeTruthy();
    expect(select('tanker-settings-selection').value).toBe('false');
    expect(select('tanker-settings-voucher').value).toBe('station');
    expect(select('tanker-settings-overrun').value).toBe('allow_with_confirmation');
    expect(screen.getByText(T(locale).settings.voucher.fixedBlock)).toBeTruthy();
    expect(screen.getByText(T(locale).settings.voucher.fixedZeros)).toBeTruthy();
    expect(screen.getByText(T(locale).settings.voucher.fixedVoided)).toBeTruthy();
    expect(screen.queryByRole('option', { name: /supervisor_approval/ })).toBeNull();
  });

  it('saves only the changed policies at organization scope, with the optional reason, and never sends a tenant id', async () => {
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    const save = screen.getByRole('button', { name: T(locale).settings.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(select('tanker-settings-selection'), { target: { value: 'true' } });
    fireEvent.change(select('tanker-settings-overrun'), { target: { value: 'block' } });
    fireEvent.change(document.getElementById('tanker-settings-reason')!, { target: { value: 'سبب' } });
    fireEvent.click(save);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ path: '/fuel-stations/settings', method: 'PUT', body: { tanker_selection_required: true, tanker_capacity_overrun_policy: 'block', reason: 'سبب' } });
    expect(JSON.stringify(writes()[0].body)).not.toMatch(/tenant/);
    await waitFor(() => expect(toast).toHaveBeenCalledWith(T(locale).settings.saved));
    await waitFor(() => expect((screen.getByRole('button', { name: T(locale).settings.save }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('at station scope inherit sends null (clears the override) and a station value sends the value', async () => {
    state.station = { tanker_selection_required: false, tanker_voucher_unique_scope: 'owner', tanker_capacity_overrun_policy: 'allow_with_confirmation' };
    state.overrides = ['tanker_voucher_unique_scope'];
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    fireEvent.change(select('tanker-settings-scope'), { target: { value: ST1 } });
    await waitFor(() => expect(select('tanker-settings-voucher').value).toBe('owner'));
    fireEvent.change(select('tanker-settings-voucher'), { target: { value: 'inherit' } });
    fireEvent.change(select('tanker-settings-overrun'), { target: { value: 'allow' } });
    fireEvent.click(screen.getByRole('button', { name: T(locale).settings.save }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].path).toBe(`/fuel-stations/stations/${ST1}/settings?branch=all`);
    expect(writes()[0].body).toEqual({ tanker_voucher_unique_scope: null, tanker_capacity_overrun_policy: 'allow' });
  });

  it('without the governance permission the policies are read-only and nothing can be sent; the nozzle editor stays available to station managers', async () => {
    state.permissions = ['fuel.tanker.view', 'fuel_stations.view', 'fuel_stations.manage'];
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    expect(select('tanker-settings-selection').disabled).toBe(true);
    expect(select('tanker-settings-voucher').disabled).toBe(true);
    expect(select('tanker-settings-overrun').disabled).toBe(true);
    expect((screen.getByRole('button', { name: T(locale).settings.save }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/fuel\.governance\.manage/)).toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it('view-only users cannot edit anything', async () => {
    state.permissions = ['fuel.tanker.view', 'fuel_stations.view'];
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    expect(select('tanker-settings-selection').disabled).toBe(true);
    expect(screen.getByText(/fuel_stations\.manage/)).toBeTruthy();
  });

  it('shows a server refusal (403) as the governance message and keeps the draft', async () => {
    state.permissions = GOV;
    state.fail['PUT /fuel-stations/settings'] = 403;
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    fireEvent.change(select('tanker-settings-voucher'), { target: { value: 'tenant' } });
    fireEvent.click(screen.getByRole('button', { name: T(locale).settings.save }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(select('tanker-settings-voucher').value).toBe('tenant');
    expect(toast).not.toHaveBeenCalled();
  });

  it('closed feature gate (404 on the owners probe) shows the closed state and requests nothing else', async () => {
    state.fail['GET /fuel-stations/tanker-owners'] = 404;
    renderIntl(<TankerSettingsScreen />, locale);
    expect(await screen.findByText(T(locale).states.gateClosedTitle)).toBeTruthy();
    expect(calls.map((c) => c.path)).toEqual(['/fuel-stations/tanker-owners']);
  });

  it('no tanker.view permission: denied without any request', async () => {
    state.permissions = ['fuel_stations.manage'];
    renderIntl(<TankerSettingsScreen />, locale);
    expect(await screen.findByText(T(locale).states.forbiddenTitle)).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('nozzle operations: only the selected station nozzles, the full set is sent as null, an empty set cannot be saved', async () => {
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    expect(screen.getByText(T(locale).settings.nozzles.pickStation)).toBeTruthy();
    fireEvent.change(select('tanker-settings-scope'), { target: { value: ST1 } });
    const row1 = await waitFor(() => { const el = document.querySelector(`[data-nozzle="${N1}"]`); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(document.querySelectorAll('[data-nozzle]')).toHaveLength(2); // لا فوهة محطة أخرى
    const row2 = document.querySelector(`[data-nozzle="${N2}"]`) as HTMLElement;
    const ops = (row: HTMLElement) => within(row).getAllByRole('checkbox') as HTMLInputElement[];
    expect(ops(row1).map((c) => c.checked)).toEqual([true, true, true]); // NULL = كل العمليات
    expect(ops(row2).map((c) => c.checked)).toEqual([false, true, false]);

    // تضييق فوهة 1: يظهر تلميح الحوكمة ثم يُرسَل المسموح فقط.
    fireEvent.click(ops(row1)[0]);
    fireEvent.click(ops(row1)[2]);
    expect(within(row1).getByText(/fuel\.governance\.manage/)).toBeTruthy();
    fireEvent.click(within(row1).getByRole('button', { name: T(locale).settings.nozzles.save }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ path: `/fuel-stations/nozzles/${N1}`, method: 'PUT', body: { allowed_operations: ['tanker_fill'] } });

    // توسيع فوهة 2 إلى الكل ⇒ null.
    fireEvent.click(ops(row2)[0]);
    fireEvent.click(ops(row2)[2]);
    fireEvent.click(within(row2).getByRole('button', { name: T(locale).settings.nozzles.save }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toEqual({ allowed_operations: null });

    // فارغ غير مسموح: رسالة والحفظ معطّل.
    for (const box of ops(row1).filter((c) => c.checked)) fireEvent.click(box);
    expect(within(row1).getByText(T(locale).settings.nozzles.needOne)).toBeTruthy();
    expect((within(row1).getByRole('button', { name: T(locale).settings.nozzles.save }) as HTMLButtonElement).disabled).toBe(true);
    expect(writes()).toHaveLength(2);
  });

  it('a server refusal of a nozzle narrowing (403) shows the governance message on that nozzle only', async () => {
    state.fail[`PUT /fuel-stations/nozzles/${N1}`] = 403;
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    fireEvent.change(select('tanker-settings-scope'), { target: { value: ST1 } });
    const row1 = await waitFor(() => { const el = document.querySelector(`[data-nozzle="${N1}"]`); expect(el).toBeTruthy(); return el as HTMLElement; });
    fireEvent.click(within(row1).getAllByRole('checkbox')[0]);
    fireEvent.click(within(row1).getByRole('button', { name: T(locale).settings.nozzles.save }));
    expect(await within(row1).findByRole('alert')).toBeTruthy();
    expect(within(document.querySelector(`[data-nozzle="${N2}"]`) as HTMLElement).queryByRole('alert')).toBeNull();
    // لا نجاح مزيَّف: القيد الظاهر يبقى كما كان قبل الحفظ.
    expect(toast).not.toHaveBeenCalled();
  });
  it('tanker.view without fuel_stations.view is denied up-front with the missing key and no request (the API reads need fuel_stations.view)', async () => {
    state.permissions = ['fuel.tanker.view'];
    renderIntl(<TankerSettingsScreen />, locale);
    expect(await screen.findByText(T(locale).states.forbiddenTitle)).toBeTruthy();
    expect(screen.getByText('fuel_stations.view')).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('pinning a station override equal to the effective organization value is sent (it is an override, not a no-op)', async () => {
    state.tenant = { tanker_selection_required: false, tanker_voucher_unique_scope: 'station', tanker_capacity_overrun_policy: 'block' };
    state.station = { ...state.tenant };
    state.overrides = [];
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    fireEvent.change(select('tanker-settings-scope'), { target: { value: ST1 } });
    await waitFor(() => expect(select('tanker-settings-overrun').value).toBe('inherit'));
    fireEvent.change(select('tanker-settings-overrun'), { target: { value: 'block' } });
    fireEvent.click(screen.getByRole('button', { name: T(locale).settings.save }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ tanker_capacity_overrun_policy: 'block' });
    await waitFor(() => expect(select('tanker-settings-overrun').value).toBe('block'));
    // بعد الحفظ يظهر كتجاوز صريح (من meta.overrides) لا كموروث.
    expect(state.overrides).toEqual(['tanker_capacity_overrun_policy']);
  });

  it('a late nozzle response for a previously selected station never overwrites the selected station (Codex P2)', async () => {
    const ST2_NOZZLE = '00000000-0000-4000-8000-0000000000c1';
    state.nozzles.push({ id: ST2_NOZZLE, fuel_station_id: ST2, nozzle_number: '7', pump: { pump_number: '3' }, fuel_product_id: 'x', fuel_product: { name: 'ديزل' }, status: 'active', allowed_operations: null });
    let release!: () => void;
    state.holds = [new Promise<void>((resolve) => { release = resolve; })]; // أول طلب فوهات (محطة أ) يتأخر
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    fireEvent.change(select('tanker-settings-scope'), { target: { value: ST1 } }); // طلب متأخر
    fireEvent.change(select('tanker-settings-scope'), { target: { value: ST2 } }); // يكتمل أولاً
    await waitFor(() => expect(document.querySelector(`[data-nozzle="${ST2_NOZZLE}"]`)).toBeTruthy());
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect([...document.querySelectorAll('[data-nozzle]')].map((el) => el.getAttribute('data-nozzle'))).toEqual([ST2_NOZZLE]);
    // الحفظ يستهدف فوهة المحطة المعروضة فقط.
    fireEvent.click(within(document.querySelector(`[data-nozzle="${ST2_NOZZLE}"]`) as HTMLElement).getAllByRole('checkbox')[0]);
    fireEvent.click(within(document.querySelector(`[data-nozzle="${ST2_NOZZLE}"]`) as HTMLElement).getByRole('button', { name: T(locale).settings.nozzles.save }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].path).toBe(`/fuel-stations/nozzles/${ST2_NOZZLE}`);
  });
  it('the scope selector is locked while a save is pending, so its result never shows under another scope (Codex P2)', async () => {
    let release!: () => void;
    state.saveHold = new Promise<void>((resolve) => { release = resolve; });
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    fireEvent.change(select('tanker-settings-scope'), { target: { value: ST1 } });
    await waitFor(() => expect(select('tanker-settings-overrun').value).toBe('allow_with_confirmation'));
    fireEvent.change(select('tanker-settings-overrun'), { target: { value: 'block' } });
    fireEvent.click(screen.getByRole('button', { name: T(locale).settings.save }));
    await waitFor(() => expect(select('tanker-settings-scope').disabled).toBe(true));
    release();
    await waitFor(() => expect(select('tanker-settings-scope').disabled).toBe(false));
    expect(select('tanker-settings-scope').value).toBe(ST1);
    expect(select('tanker-settings-overrun').value).toBe('block');
  });
  it('station settings are requested for all of the user\'s branches, matching the access-scoped station list (Codex P2)', async () => {
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    fireEvent.change(select('tanker-settings-scope'), { target: { value: ST1 } });
    await waitFor(() => expect(calls.some((c) => c.path === `/fuel-stations/stations/${ST1}/settings?branch=all`)).toBe(true));
    expect(calls.filter((c) => /\/stations\/[0-9a-f-]{36}\/settings/.test(c.path)).every((c) => c.path.endsWith('?branch=all'))).toBe(true);
  });

  it('a failing station settings load is not a closed gate: the selector stays, organization scope is shown with a message (Codex P2)', async () => {
    state.fail[`GET /fuel-stations/stations/${ST2}/settings`] = 404;
    renderIntl(<TankerSettingsScreen />, locale);
    await screen.findByRole('heading', { name: T(locale).settings.title });
    fireEvent.change(select('tanker-settings-scope'), { target: { value: ST2 } });
    expect(await screen.findByText(T(locale).settings.stationUnavailable)).toBeTruthy();
    await waitFor(() => expect(select('tanker-settings-scope').value).toBe(''));
    expect(screen.queryByText(T(locale).states.gateClosedTitle)).toBeNull();
    // التعافي داخل الشاشة: اختيار محطة سليمة يعمل ويمسح الرسالة.
    fireEvent.change(select('tanker-settings-scope'), { target: { value: ST1 } });
    await waitFor(() => expect(select('tanker-settings-scope').value).toBe(ST1));
    expect(screen.queryByText(T(locale).settings.stationUnavailable)).toBeNull();
  });
});
