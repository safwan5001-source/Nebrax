// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/tanker-fills' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import { StationOpsShell } from '../shell';
import { OWNER_A, ST, TANKER_A, UID, buildWorld, connect, type FillRowWorld, type World } from './__tanker-backend';
import { TankerFillDetailScreen } from './detail-screen';
import { TankerFillHomeEntry } from './home-entry';
import { TankerFillListScreen } from './list-screen';

const apiMock = vi.mocked(api);
const VIEWER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.tanker.view', 'fuel.tanker.fill.view'];
const RECORDER = [...VIEWER, 'fuel.tanker.fill.record'];
let world: World;

function seed(permissions: string[], opts: { pin?: boolean } = {}) {
  const user: AuthUser & { station_session?: boolean } = { id: 'u1', name: 'Worker', email: 'w@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  if (opts.pin) {
    localStorage.setItem('station_token', 'tok');
    localStorage.setItem('station_user', JSON.stringify({ ...user, station_session: true }));
  } else {
    localStorage.setItem('token', 'token');
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('station_use_erp', user.id); // اختيار صريح لاستعمال جلسة أَوْج الكاملة داخل التطبيق
  }
}

const fillRow = (n: number, over: Partial<FillRowWorld> = {}): FillRowWorld => ({
  id: UID(900 + n), number: `FTF-2027-${String(n).padStart(5, '0')}`, voucher_number: `0${4000 + n}`, status: 'recorded', inventory_status: 'pending_integration', fuel_station_id: ST, fuel_shift_id: 'sh1',
  fuel_pump_id: 'pu1', fuel_nozzle_id: 'nz1', fuel_tank_id: 'tk1', fuel_product_id: 'p1', fuel_tanker_owner_id: OWNER_A, fuel_tanker_id: TANKER_A, quantity_milliliters: 2_000_000, quantity_liters: '2000.000',
  capacity_overrun_milliliters: null, recorded_at: '2027-01-26T09:00:00+03:00', voided_at: null, owner: { id: OWNER_A, name: 'Askar', code: 'ASK' }, tanker: { id: TANKER_A, plate_number: 'ABJ 1234', capacity_milliliters: 5_000_000 },
  attachments_count: 0, ...over,
});

function setup(over: Partial<World> = {}, permissions = VIEWER, opts: { pin?: boolean } = {}) {
  seed(permissions, opts);
  world = buildWorld(over);
  connect(world, apiMock as never);
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); apiMock.mockReset(); });
afterEach(() => cleanup());

const mountList = () => renderIntl(<StationOpsShell><TankerFillListScreen /></StationOpsShell>, 'en');
const mountDetail = (id: string) => renderIntl(<StationOpsShell><TankerFillDetailScreen id={id} /></StationOpsShell>, 'en');

describe('fills list (current shift only)', () => {
  it('lists the current shift’s fills with totals that exclude voided ones, plus the no-deduction note', async () => {
    setup({ fills: [fillRow(1), fillRow(2, { quantity_milliliters: 1_500_000 }), fillRow(3, { status: 'voided', quantity_milliliters: 9_000_000 }), fillRow(4, { fuel_shift_id: 'other' })] });
    mountList();
    await screen.findByText('FTF-2027-00001');
    expect(document.querySelectorAll('[data-fill-row]')).toHaveLength(3); // الوردية الأخرى لا تُعرض
    expect((document.querySelector('[data-total-count]') as HTMLElement).textContent).toBe('2');
    expect((document.querySelector('[data-total-liters]') as HTMLElement).textContent).toContain('3,500');
    expect(document.querySelector('[data-no-stock-note]')).not.toBeNull();
    expect(document.querySelector('[data-shift-line]')?.textContent).toContain('FSH-0001');
    expect(world.posts).toHaveLength(0);
  });

  it('shows the paper voucher with its leading zero', async () => {
    setup({ fills: [fillRow(1, { voucher_number: '04052' })] });
    mountList();
    const row = await screen.findByText('FTF-2027-00001');
    expect(within(row.closest('[data-fill-row]') as HTMLElement).getByText('04052')).toBeTruthy();
  });

  it('the "New fill" action appears only with the record permission and an open shift', async () => {
    setup({}, RECORDER);
    mountList();
    expect(await screen.findByRole('link', { name: /Record a new fill/ })).toBeTruthy();
    cleanup();
    setup({}, VIEWER);
    mountList();
    await screen.findByText('No fills yet');
    expect(screen.queryByRole('link', { name: /Record a new fill/ })).toBeNull();
    cleanup();
    setup({ openShift: null }, RECORDER);
    mountList();
    await screen.findByText('No open shift');
    expect(screen.queryByRole('link', { name: /Record a new fill/ })).toBeNull();
  });

  it('gate closed ⇒ "Feature not enabled"; no view permission ⇒ refusal without any fills request', async () => {
    setup({ gateClosed: true });
    mountList();
    expect(await screen.findByText('Feature not enabled')).toBeTruthy();
    cleanup();
    setup({}, ['fuel_stations.view', 'fuel.shift.view']);
    mountList();
    expect(await screen.findByText('You cannot record tanker fills')).toBeTruthy();
    expect(world.gets.some((url) => url.includes('tanker-fills'))).toBe(false);
  });

  it('only this station’s rows are ever shown (defence in depth against a mixed server response)', async () => {
    setup({ fills: [fillRow(1), fillRow(2, { fuel_station_id: 'st-other' })] });
    mountList();
    await screen.findByText('FTF-2027-00001');
    expect(screen.queryByText('FTF-2027-00002')).toBeNull();
  });
});

describe('recovery entry point', () => {
  const pendingBody = { fuel_station_id: ST, fuel_nozzle_id: 'nz1', fuel_tanker_owner_id: OWNER_A, fuel_shift_id: 'sh1', voucher_number: '04052', quantity_milliliters: 2_000_000, idempotency_key: 'awj-ops-0f8a1c2d-3e4b-4a5c-9d6e-7f8091a2b3c4' };
  const savePending = (userId = 'u1') => sessionStorage.setItem(`awj:fuel-ops:tanker-fill:pending:T1|${userId}|default|||${ST}`, JSON.stringify({ body: pendingBody, at: Date.now() }));

  it('an unresolved attempt keeps a link to the recovery screen even when the shift is closed', async () => {
    setup({ openShift: null }, RECORDER);
    savePending();
    mountList();
    await screen.findByText('No open shift');
    const link = document.querySelector('[data-pending-link]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/fuel-stations/ops/tanker-fills/new');
    expect(link.textContent).toContain('Unresolved recording attempt');
    expect(screen.queryByRole('link', { name: /Record a new fill/ })).toBeNull(); // التسجيل الجديد ما زال يتطلب وردية
  });

  it('with an open shift the recovery link is shown next to the normal action', async () => {
    setup({}, RECORDER);
    savePending();
    mountList();
    await screen.findByRole('link', { name: /Record a new fill/ });
    expect(document.querySelector('[data-pending-link]')).not.toBeNull();
  });

  it('no unresolved attempt, another employee’s attempt, or no record permission ⇒ no recovery link', async () => {
    setup({ openShift: null }, RECORDER);
    mountList();
    await screen.findByText('No open shift');
    expect(document.querySelector('[data-pending-link]')).toBeNull();
    cleanup();

    setup({ openShift: null }, RECORDER);
    savePending('someone-else');
    mountList();
    await screen.findByText('No open shift');
    expect(document.querySelector('[data-pending-link]')).toBeNull();
    cleanup();

    setup({ openShift: null }, VIEWER);
    savePending();
    mountList();
    await screen.findByText('No open shift');
    expect(document.querySelector('[data-pending-link]')).toBeNull();
  });
});

describe('fill detail (read-only)', () => {
  it('shows both numbers separately, status "awaiting stock integration", derived product/tank, and no write buttons', async () => {
    const row = fillRow(1, { voucher_number: '04052', capacity_overrun_milliliters: 250_000 });
    setup({ fills: [row] });
    mountDetail(row.id);
    expect((await screen.findByText('FTF-2027-00001')).getAttribute('data-fill-number')).toBe('');
    expect(document.querySelector('[data-fill-voucher]')?.textContent).toBe('04052');
    expect(screen.getByText('Awaiting stock integration')).toBeTruthy();
    expect(screen.getByText('Diesel')).toBeTruthy();
    expect(screen.getByText('Tank Diesel')).toBeTruthy();
    expect(document.querySelector('[data-detail-overrun]')?.textContent).toContain('250.000');
    expect(document.querySelector('[data-no-stock-note]')).not.toBeNull();
    for (const name of [/void/i, /cancel/i, /post/i, /reverse/i, /delete/i]) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(world.posts).toHaveLength(0);
  });

  it('equipment comes from the FILL’s stored ids, not the nozzle’s current configuration (nozzle reassigned after recording)', async () => {
    const row = fillRow(1, { fuel_pump_id: 'pu2', fuel_tank_id: 'tk-old', fuel_product_id: 'p-old' });
    setup({ fills: [row] });
    world.tanks = [...world.tanks, { ...world.tanks[0], id: 'tk-old', name: 'Old Petrol Tank', fuel_product_id: 'p-old' }];
    mountDetail(row.id);
    await screen.findByText('FTF-2027-00001');
    await screen.findByText('Old Petrol Tank');
    expect(screen.queryByText('Tank Diesel')).toBeNull(); // الخزان الحالي للفوهة لا يُعرض لسند تاريخي
    expect(screen.queryByText('Diesel')).toBeNull();
  });

  it('a fill that belongs to another station/tenant (server 404) is simply "not found"', async () => {
    setup({ fills: [] });
    mountDetail(UID(555));
    expect(await screen.findByText(/not found|isn.t available|no longer/i)).toBeTruthy();
  });

  it('a malformed id never reaches the network', async () => {
    setup({ fills: [fillRow(1)] });
    mountDetail('../../accounts');
    await waitFor(() => expect(document.querySelector('[data-tanker-detail]')).toBeNull());
    expect(world.gets.some((url) => url.includes('..'))).toBe(false);
  });

  it('PIN session: attachments count + explicit note, and the attachments component (which would call non-whitelisted routes) is NOT rendered', async () => {
    const row = fillRow(1, { attachments_count: 2 });
    const realLocation = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { pathname: '/fuel-stations/ops/tanker-fills', href: 'http://localhost/fuel-stations/ops/tanker-fills', assign: vi.fn() } });
    setup({ fills: [row] }, VIEWER, { pin: true });
    mountDetail(row.id);
    await screen.findByText('FTF-2027-00001');
    const block = document.querySelector('[data-attachments-pin]') as HTMLElement;
    expect(block).not.toBeNull();
    expect(block.textContent).toContain('2');
    expect(document.querySelector('[data-tanker-fill-attachments]')).toBeNull();
    expect(world.gets.some((url) => url.includes('/attachments'))).toBe(false);
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('full ERP-credential session in the app: the existing attachments component is wired', async () => {
    const row = fillRow(1);
    setup({ fills: [row] }, [...VIEWER, 'fuel.tanker.fill.attachment.add']);
    mountDetail(row.id);
    await screen.findByText('FTF-2027-00001');
    await waitFor(() => expect(world.gets.some((url) => url.includes('/attachments'))).toBe(true));
    expect(document.querySelector('[data-attachments-pin]')).toBeNull();
  });
});

describe('home entry card', () => {
  const mountEntry = () => {
    const station = { ...buildWorld().station };
    return renderIntl(<StationOpsShell><TankerFillHomeEntry station={station} /></StationOpsShell>, 'en');
  };

  it('appears only when the server confirms the feature (read of fills returns 200)', async () => {
    setup({}, VIEWER);
    mountEntry();
    expect(await screen.findByRole('link', { name: /Tanker fills/ })).toBeTruthy();
  });

  it.each([
    ['gate closed (404)', { gateClosed: true }, VIEWER],
    ['no view permission', {}, ['fuel_stations.view']],
  ])('is completely absent: %s', async (_label, over, permissions) => {
    setup(over as Partial<World>, permissions as string[]);
    mountEntry();
    await waitFor(() => expect(apiMock.mock.calls.length >= 0).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('link', { name: /Tanker fills/ })).toBeNull();
  });
});
