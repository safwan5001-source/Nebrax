// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

const nav = vi.hoisted(() => ({ pathname: '/fuel-stations/ops/tanks', replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }) }));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme Fuel Co', logo: null }) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn() }));

import { api } from '@/lib/api';
import type { AuthUser } from '@/lib/auth';
import { product, station } from '../__fixtures__';
import { StationOpsShell } from '../shell';
import { connectTanks, type PolicyState, type StoredRequest, type TanksWorld } from './__tanks-backend';
import { PolicyScreen } from './policy-screen';
import { RequestsScreen } from './requests-screen';
import { TankDetailScreen } from './tank-detail-screen';

const apiMock = vi.mocked(api);
const VIEWER = 'u-sup';
const ST = '00000000-0000-4000-8000-0000000000a1';
const T1 = '00000000-0000-4000-8000-000000000001';
const NOW = '2026-11-06T12:00:00+00:00';
const RECORD = ['fuel_stations.view', 'fuel.reading.view', 'fuel.reading.record'];
const APPROVER = [...RECORD, 'fuel.reading.late.approve'];
const GOVERN = ['fuel_stations.view', 'fuel_stations.manage', 'fuel.governance.manage'];
const SUPERVISED: PolicyState = { policy: 'supervisor_approval', max_hours: 24, reason_required: true };

function seedUser(permissions: string[]): void {
  const user: AuthUser = { id: VIEWER, name: 'Sup Visor', email: 'sup@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

function build(over: Partial<TanksWorld> = {}): TanksWorld {
  return {
    data: { stations: [station(ST, { name: 'Station A', timezone: 'Asia/Riyadh' })], products: [product('p1', 'Alpha')], pumps: [], nozzles: [], tanks: [], prices: [], shifts: [] },
    tanks: [{ id: T1, station: ST, code: 'T1', name: 'Tank One', capacity: 200_000, safe: 190_000, minimum: 20_000, dead: 0 }],
    readings: [], posts: [], gets: [], viewerId: VIEWER, viewerName: 'Sup Visor', staleAfter: null, now: NOW, policy: SUPERVISED, requests: [], ...over,
  };
}

const request = (id: string, over: Partial<StoredRequest> = {}): StoredRequest => ({
  id, status: 'pending', fuel_tank_id: T1, fuel_station_id: ST, reading_type: 'physical', quantity_milliliters: 55_000, evidence_key: `k-${id}`, evidence: { method: 'dipstick', note: 'seed note' },
  reason: 'Forgot to record', measured_at: '2026-11-06T04:00:00.000Z', requested_at: '2026-11-06T11:00:00+00:00', requested_by: 'u-other', requester_name: 'Other Person',
  decided_by: null, decider_name: null, decided_at: null, decision_note: null, fuel_tank_reading_id: null, ...over,
});
const RID = (n: number) => `00000000-0000-4000-8000-${String(800 + n).padStart(12, '0')}`;

let world: TanksWorld;
function connect(w: TanksWorld) { world = w; connectTanks(w, apiMock as never); }
const writes = () => apiMock.mock.calls.filter(([, init]) => ['POST', 'PUT'].includes((init as { method?: string } | undefined)?.method ?? ''));

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear(); sessionStorage.clear(); apiMock.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  nav.pathname = '/fuel-stations/ops/tanks';
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderOps = (ui: React.ReactElement, locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell>{ui}</StationOpsShell>, locale);

async function fillQuantity(user: ReturnType<typeof userEvent.setup>, liters: string) {
  const input = await screen.findByTestId('tank-quantity');
  await user.clear(input);
  await user.type(input, liters);
}
const pickTime = async (value: string) => {
  const input = await screen.findByLabelText(/Actual measurement time/);
  fireEvent.change(input, { target: { value } });
};
async function enableLate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByLabelText(/Record with an earlier date/));
}
const reviewButton = () => screen.getByRole('button', { name: /Review and/ }) as HTMLButtonElement;

describe('recording a late reading', () => {
  it('shows the earlier-date option only when the policy lets this user submit', async () => {
    seedUser(RECORD);
    connect(build({ policy: { policy: 'deny', max_hours: 24, reason_required: true } }));
    renderOps(<TankDetailScreen id={T1} />);
    await screen.findByTestId('tank-quantity');
    expect(document.querySelector('[data-late-section]')).toBeNull();
    cleanup();

    connect(build({ policy: { policy: 'authorized_user', max_hours: 24, reason_required: true }, canLateRecord: false }));
    renderOps(<TankDetailScreen id={T1} />);
    await screen.findByTestId('tank-quantity');
    expect(document.querySelector('[data-late-section]')).toBeNull(); // بلا الصلاحية المخصّصة لا خيار
    cleanup();

    connect(build());
    renderOps(<TankDetailScreen id={T1} />);
    await screen.findByTestId('tank-quantity');
    expect(document.querySelector('[data-late-section]')).toBeTruthy();
  });

  it('validates the chosen time and the mandatory reason before any request, then sends a pending request with the user-chosen station-zone time', async () => {
    const user = userEvent.setup();
    seedUser(RECORD);
    connect(build());
    renderOps(<TankDetailScreen id={T1} />);
    await fillQuantity(user, '55');
    await enableLate(user);

    // بلا وقت ⇒ لا مراجعة؛ مستقبل/قريب/أبعد من الحد ⇒ خطأ نصي
    expect(reviewButton().disabled).toBe(true);
    await pickTime('2026-11-06T16:00');
    expect((await screen.findByRole('alert', { name: '' }).catch(() => document.querySelector('[data-late-error]')))).toBeTruthy();
    expect(document.querySelector('[data-late-error]')?.getAttribute('data-late-error')).toBe('future');
    await pickTime('2026-11-06T14:58'); // 11:58Z — ضمن السماحية
    expect(document.querySelector('[data-late-error]')?.getAttribute('data-late-error')).toBe('not_late');
    await pickTime('2026-11-04T09:00'); // أكثر من 24 ساعة
    expect(document.querySelector('[data-late-error]')?.getAttribute('data-late-error')).toBe('too_old');
    expect(reviewButton().disabled).toBe(true);

    await pickTime('2026-11-06T09:00'); // 06:00Z = قبل 6 ساعات
    expect(document.querySelector('[data-late-error]')).toBeNull();
    expect(reviewButton().disabled).toBe(true); // السبب إلزامي
    await user.type(document.querySelector('[data-late-reason]') as HTMLElement, '  Network was down  ');
    expect(reviewButton().disabled).toBe(false);
    expect(writes()).toHaveLength(0);

    await user.click(reviewButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/awaiting|approval|supervisor/i)).toBeTruthy();
    expect(dialog.querySelector('[data-approval-note]')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Save reading' }));

    await waitFor(() => expect(document.querySelector('[data-pending-sent]')).toBeTruthy());
    expect(document.querySelector('[data-saved]')).toBeNull(); // لا «تم الحفظ»: ليست قراءة تشغيلية
    expect(writes()).toHaveLength(1);
    expect(world.posts[0].body).toMatchObject({ fuel_tank_id: T1, quantity_liters: '55', measured_at: '2026-11-06T06:00:00.000Z', late_reason: 'Network was down' });
    expect(world.requests).toHaveLength(1);
    expect(world.readings).toHaveLength(0); // لا قراءة قبل الاعتماد
  });

  it('records directly with the dedicated permission and says it was saved', async () => {
    const user = userEvent.setup();
    seedUser(RECORD);
    connect(build({ policy: { policy: 'authorized_user', max_hours: 24, reason_required: false }, canLateRecord: true }));
    renderOps(<TankDetailScreen id={T1} />);
    await fillQuantity(user, '60');
    await enableLate(user);
    await pickTime('2026-11-06T09:00');
    expect(document.querySelector('[data-late-reason]')?.getAttribute('aria-required')).toBe('false');
    await user.click(reviewButton());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));
    await screen.findByText('The reading was saved.');
    expect(world.readings).toHaveLength(1);
    expect(world.readings[0].measured_at).toBe('2026-11-06T06:00:00.000Z');
    expect(document.querySelector('[data-pending-sent]')).toBeNull();
    // السجل يعلّم القراءة المتأخرة
    await waitFor(() => expect(document.querySelector('[data-late-entry]')).toBeTruthy());
  });

  it('shows a server rejection (policy changed after load) as final and keeps the typed values', async () => {
    const user = userEvent.setup();
    seedUser(RECORD);
    connect(build());
    renderOps(<TankDetailScreen id={T1} />);
    await fillQuantity(user, '55');
    await enableLate(user);
    await pickTime('2026-11-06T09:00');
    await user.type(document.querySelector('[data-late-reason]') as HTMLElement, 'x');
    world.policy = { policy: 'deny', max_hours: 24, reason_required: true };
    await user.click(reviewButton());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toMatch(/does not allow recording readings with an earlier date/);
    expect((screen.getByTestId('tank-quantity') as HTMLInputElement).value).toBe('55');
    expect(world.requests).toHaveLength(0);
  });

  it('after a lost reply “check” finds the pending request by its key and does not resend', async () => {
    const user = userEvent.setup();
    seedUser(RECORD);
    let drop = true;
    connect(build({ dropReplyAfterApply: () => { const now = drop; drop = false; return now; } }));
    renderOps(<TankDetailScreen id={T1} />);
    await fillQuantity(user, '55');
    await enableLate(user);
    await pickTime('2026-11-06T09:00');
    await user.type(document.querySelector('[data-late-reason]') as HTMLElement, 'x');
    await user.click(reviewButton());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));
    const notice = await screen.findByRole('alert');
    expect(world.requests).toHaveLength(1);
    await user.click(within(notice).getByRole('button', { name: /Check/i }));
    await waitFor(() => expect(document.querySelector('[data-pending-sent]')).toBeTruthy());
    expect(writes()).toHaveLength(1);
  });
});

describe('the late-request queue', () => {
  it('lets an authorized supervisor approve with a confirmation, creating the reading at its original time', async () => {
    const user = userEvent.setup();
    seedUser(APPROVER);
    connect(build({ requests: [request(RID(1))] }));
    renderOps(<RequestsScreen />);
    const card = await waitFor(() => { const el = document.querySelector(`[data-request-card="${RID(1)}"]`); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(within(card).getByText('Awaiting approval')).toBeTruthy();
    expect(within(card).getByText(/Forgot to record/)).toBeTruthy();
    await user.click(card.querySelector('[data-approve]') as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    expect(writes()).toHaveLength(0); // التأكيد قبل الإرسال
    await user.click(within(dialog).getByRole('button', { name: 'Confirm approval' }));
    await waitFor(() => expect(world.requests![0].status).toBe('approved'));
    expect(world.readings).toHaveLength(1);
    expect(world.readings[0].measured_at).toBe('2026-11-06T04:00:00.000Z');
    expect(world.posts[0].path).toBe(`/fuel-stations/reading-requests/${RID(1)}/approve`);
  });

  it('requires a reason to reject and then records the decision', async () => {
    const user = userEvent.setup();
    seedUser(APPROVER);
    connect(build({ requests: [request(RID(2))] }));
    renderOps(<RequestsScreen />);
    const card = await waitFor(() => { const el = document.querySelector(`[data-request-card="${RID(2)}"]`); expect(el).toBeTruthy(); return el as HTMLElement; });
    await user.click(card.querySelector('[data-reject]') as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm rejection' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(dialog.querySelector('[data-decision-note]') as HTMLElement, 'Suspicious dip');
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() => expect(world.requests![0].status).toBe('rejected'));
    expect(world.posts[0].body).toEqual({ note: 'Suspicious dip' });
    expect(world.readings).toHaveLength(0);
  });

  it('never offers a decision on your own request, and shows other users the awaiting state only', async () => {
    seedUser(APPROVER);
    connect(build({ requests: [request(RID(3), { requested_by: VIEWER, requester_name: 'Sup Visor' })] }));
    renderOps(<RequestsScreen />);
    const card = await waitFor(() => { const el = document.querySelector(`[data-request-card="${RID(3)}"]`); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(card.querySelector('[data-approve]')).toBeNull();
    expect(card.querySelector('[data-reject]')).toBeNull();
    expect(card.querySelector('[data-self-note]')).toBeTruthy();
    cleanup();

    seedUser(RECORD); // مقدِّم بلا صلاحية الاعتماد
    connect(build({ requests: [request(RID(4), { requested_by: VIEWER, requester_name: 'Sup Visor' })] }));
    renderOps(<RequestsScreen />);
    const own = await waitFor(() => { const el = document.querySelector(`[data-request-card="${RID(4)}"]`); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(own.querySelector('[data-approve]')).toBeNull();
    expect(within(own).getByText('Awaiting supervisor approval')).toBeTruthy();
  });

  it('refreshes from the server when the request was already decided elsewhere (409) instead of retrying', async () => {
    const user = userEvent.setup();
    seedUser(APPROVER);
    const w = build({ requests: [request(RID(5))] });
    w.beforePost = (_post, state) => { state.requests![0].status = 'approved'; state.requests![0].decided_by = 'u-third'; state.requests![0].decider_name = 'Third'; };
    connect(w);
    renderOps(<RequestsScreen />);
    const card = await waitFor(() => { const el = document.querySelector(`[data-request-card="${RID(5)}"]`); expect(el).toBeTruthy(); return el as HTMLElement; });
    await user.click(card.querySelector('[data-approve]') as HTMLElement);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm approval' }));
    await screen.findByRole('alert');
    expect(writes()).toHaveLength(1);
    expect(world.readings).toHaveLength(0);
  });

  it('shows decided requests with who decided, when and the note, and has no accessibility violations (ar)', async () => {
    const user = userEvent.setup();
    seedUser(APPROVER);
    connect(build({ requests: [request(RID(6), { status: 'rejected', decided_by: 'u-x', decider_name: 'Boss', decided_at: '2026-11-06T11:30:00+00:00', decision_note: 'Not credible' })] }));
    const { container } = renderOps(<RequestsScreen />, 'ar');
    await user.click((await screen.findAllByRole('radio')).at(-1) as HTMLElement); // «الكل»
    await waitFor(() => expect(document.querySelector('[data-decision]')).toBeTruthy());
    expect(container.textContent).toMatch(/Boss/);
    expect(container.textContent).toMatch(/Not credible/);
    expect((await axe(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
  });
});

describe('the policy editor', () => {
  it('saves exactly the three policy keys for the station after a confirmation', async () => {
    const user = userEvent.setup();
    seedUser(GOVERN);
    connect(build({ policy: { policy: 'deny', max_hours: 24, reason_required: true }, canGovern: true }));
    renderOps(<PolicyScreen />);
    await screen.findByText('Policy for recording readings with an earlier date');
    expect((screen.getByRole('button', { name: 'Save policy' }) as HTMLButtonElement).disabled).toBe(true); // لا تغيير
    await user.click(screen.getByRole('radio', { name: /Supervisor approval/ }));
    await user.clear(document.querySelector('[data-policy-hours]') as HTMLElement);
    await user.type(document.querySelector('[data-policy-hours]') as HTMLElement, '12');
    await user.click(screen.getByLabelText(/Require a reason/));
    expect(document.querySelector('[data-policy-summary]')?.textContent).toMatch(/up to 12 hours.*optional/);
    await user.click(screen.getByRole('button', { name: 'Save policy' }));
    const dialog = await screen.findByRole('dialog');
    expect(writes()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(document.querySelector('[data-policy-saved]')).toBeTruthy());
    expect(world.posts[0].path).toBe(`/fuel-stations/stations/${ST}/settings`);
    expect(world.posts[0].method).toBe('PUT');
    expect(world.posts[0].body).toEqual({ tank_reading_backdating_policy: 'supervisor_approval', tank_reading_backdating_max_hours: 12, tank_reading_backdating_reason_required: false });
    expect(world.policy).toEqual({ policy: 'supervisor_approval', max_hours: 12, reason_required: false });
  });

  it('blocks invalid hours (including 0, 721 and non-digits) and accepts Arabic-Indic digits as 0–9', async () => {
    const user = userEvent.setup();
    seedUser(GOVERN);
    connect(build({ policy: { policy: 'deny', max_hours: 24, reason_required: true }, canGovern: true }));
    renderOps(<PolicyScreen />);
    await screen.findByText('Policy for recording readings with an earlier date');
    await user.click(screen.getByRole('radio', { name: /Supervisor approval/ }));
    const hours = document.querySelector('[data-policy-hours]') as HTMLInputElement;
    for (const bad of ['0', '721', 'abc', '']) {
      await user.clear(hours);
      if (bad !== '') await user.type(hours, bad);
      expect((screen.getByRole('button', { name: 'Save policy' }) as HTMLButtonElement).disabled, bad).toBe(true);
    }
    await user.clear(hours);
    await user.type(hours, '٣٦');
    expect((screen.getByRole('button', { name: 'Save policy' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('is read-only without the governance + manage pair and the server 403 is shown if it is reached anyway', async () => {
    const user = userEvent.setup();
    seedUser(['fuel_stations.view', 'fuel_stations.manage']);
    connect(build({ policy: { policy: 'deny', max_hours: 24, reason_required: true }, canGovern: false }));
    renderOps(<PolicyScreen />);
    await screen.findByText('Policy for recording readings with an earlier date');
    expect(document.querySelector('[data-policy-readonly]')).toBeTruthy();
    expect(document.querySelector('[data-policy-save]')).toBeNull();
    expect((document.querySelector('[data-policy-hours]') as HTMLInputElement).disabled).toBe(true);
    cleanup();

    seedUser(GOVERN);
    connect(build({ policy: { policy: 'deny', max_hours: 24, reason_required: true }, canGovern: false }));
    renderOps(<PolicyScreen />);
    await screen.findByText('Policy for recording readings with an earlier date');
    await user.click(screen.getByRole('radio', { name: /Authorized user/ }));
    await user.click(screen.getByRole('button', { name: 'Save policy' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toMatch(/not allowed/i);
    expect(world.policy?.policy).toBe('deny');
  });

  it('clears the station override by sending nulls for the three keys', async () => {
    const user = userEvent.setup();
    seedUser(GOVERN);
    connect(build({ canGovern: true }));
    renderOps(<PolicyScreen />);
    await screen.findByText('Policy for recording readings with an earlier date');
    await user.click(screen.getByRole('button', { name: 'Return to the organization setting' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(document.querySelector('[data-policy-saved]')).toBeTruthy());
    expect(world.posts[0].body).toEqual({ tank_reading_backdating_policy: null, tank_reading_backdating_max_hours: null, tank_reading_backdating_reason_required: null });
  });
});
