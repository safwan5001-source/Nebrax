// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
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
import { connectTanks, type TanksWorld } from './__tanks-backend';
import { TankDetailScreen } from './tank-detail-screen';
import { TanksScreen } from './tanks-screen';

const apiMock = vi.mocked(api);
const VIEWER = 'u-sup';
const ST = 'a';
const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';
const SUPERVISOR = ['fuel_stations.view', 'fuel.reading.view', 'fuel.reading.record'];
const SELLER = ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open'];
const NOW = '2026-11-06T12:00:00+00:00';

function seedUser(permissions: string[]): void {
  const user: AuthUser = { id: VIEWER, name: 'Sup Visor', email: 'sup@example.test', role: 'cashier', tenant_id: 'T1', permissions, branch_ids: [], warehouse_ids: [] };
  localStorage.setItem('token', 'token');
  localStorage.setItem('user', JSON.stringify(user));
}

function build(over: Partial<TanksWorld> = {}): TanksWorld {
  return {
    data: { stations: [station(ST, { name: 'Station A' })], products: [product('p1', 'Alpha')], pumps: [], nozzles: [], tanks: [], prices: [], shifts: [] },
    tanks: [
      { id: T1, station: ST, code: 'T1', name: 'Tank One', capacity: 200_000, safe: 190_000, minimum: 20_000, dead: 0 },
      { id: T2, station: ST, code: 'T2', name: 'Tank Two', capacity: 100_000, safe: 95_000, minimum: 10_000, dead: 0 },
    ],
    readings: [], posts: [], gets: [], viewerId: VIEWER, viewerName: 'Sup Visor', staleAfter: null, now: NOW, ...over,
  };
}

const stored = (id: string, tank: string, type: 'physical' | 'atg', ml: number, at: string) => ({
  id, fuel_tank_id: tank, fuel_station_id: ST, reading_type: type, quantity_milliliters: ml, evidence_key: `k-${id}`, evidence: { method: 'dipstick', note: 'seed' }, recorded_by: 'u-other', recorder_name: 'Other Person', measured_at: at,
});

let world: TanksWorld;
function connect(w: TanksWorld) { world = w; connectTanks(w, apiMock as never); }
const writes = () => apiMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === 'POST');

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  localStorage.clear(); sessionStorage.clear(); apiMock.mockReset();
  nav.pathname = '/fuel-stations/ops/tanks';
});
afterEach(() => cleanup());

const renderOps = (ui: React.ReactElement, locale: 'en' | 'ar' = 'en') => renderIntl(<StationOpsShell>{ui}</StationOpsShell>, locale);

async function openForm(user: ReturnType<typeof userEvent.setup>, liters: string) {
  const input = await screen.findByTestId('tank-quantity');
  await user.clear(input);
  await user.type(input, liters);
}

describe('the tank monitor list', () => {
  it('shows one tappable card per active tank with level, age, capacity and the review state — and never a balance', async () => {
    seedUser(SUPERVISOR);
    connect(build({ readings: [stored('r1', T1, 'physical', 150_000, '2026-11-06T09:00:00+00:00'), stored('r2', T2, 'atg', 98_000, '2026-11-06T11:30:00+00:00')] }));
    renderOps(<TanksScreen />);

    const one = await screen.findByText('Tank One');
    const cardOne = one.closest('[data-tank-card]') as HTMLElement;
    expect(cardOne.getAttribute('href')).toBe(`/fuel-stations/ops/tanks/${T1}`);
    expect(within(cardOne).getByText('75%')).toBeTruthy();
    expect(within(cardOne).getByText(/3 h ago/)).toBeTruthy();
    expect(within(cardOne).getByText(/150\.000/)).toBeTruthy();
    expect(within(cardOne).queryByText('Needs review')).toBeNull();

    // 98 L من 100 L سعتها الآمنة 95 ⇒ فوق السعة الآمنة ⇒ تحتاج مراجعة
    const cardTwo = screen.getByText('Tank Two').closest('[data-tank-card]') as HTMLElement;
    expect(within(cardTwo).getByText('Needs review')).toBeTruthy();
    expect(within(cardTwo).getByText('Above safe capacity')).toBeTruthy();
    expect(cardTwo.getAttribute('data-review')).toBe('true');
    expect(screen.getByRole('status').getAttribute('data-review-summary')).toBe('review');
    expect(screen.getByText(/not a current balance/)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('judges freshness only when the station policy is configured', async () => {
    seedUser(SUPERVISOR);
    connect(build({ readings: [stored('r1', T1, 'physical', 150_000, '2026-11-06T09:00:00+00:00')] }));
    const first = renderOps(<TanksScreen />);
    await screen.findByText('Tank One');
    expect(screen.queryByText('Outdated')).toBeNull();
    expect(screen.queryByText('Recent')).toBeNull();
    first.unmount();

    connect(build({ staleAfter: 120, readings: [stored('r1', T1, 'physical', 150_000, '2026-11-06T09:00:00+00:00')] }));
    renderOps(<TanksScreen />);
    expect(await screen.findByText('Outdated')).toBeTruthy();
  });

  it('shows a tank without readings honestly and an empty station as empty', async () => {
    seedUser(SELLER);
    connect(build());
    renderOps(<TanksScreen />);
    expect((await screen.findAllByText(/No reading yet/)).length).toBe(2);
    cleanup();
    connect(build({ tanks: [] }));
    renderOps(<TanksScreen />);
    expect(await screen.findByText('There are no active tanks for this station.')).toBeTruthy();
  });

  it('renders in Arabic with Latin digits and no accessibility violations', async () => {
    seedUser(SUPERVISOR);
    connect(build({ readings: [stored('r1', T1, 'physical', 150_000, '2026-11-06T09:00:00+00:00')] }));
    const { container } = renderOps(<TanksScreen />, 'ar');
    await screen.findByText('Tank One');
    expect(screen.getByText('مستويات الخزانات', { selector: 'h1' })).toBeTruthy();
    expect(container.textContent).toMatch(/75/);
    expect(container.textContent).not.toMatch(/[٠-٩]/);
    expect((await axe(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations).toEqual([]);
  });
});

describe('recording a standalone reading', () => {
  it('saves after a review step with the server clock, a deterministic key and the evidence — then refreshes the level and the log', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    connect(build());
    renderOps(<TankDetailScreen id={T1} />);

    await openForm(user, '150.5');
    expect(await screen.findByText(/75\.3% full with 49\.500 L available/)).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: /Note/ }), '  after unloading  ');
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    expect(writes()).toHaveLength(0); // المراجعة لا ترسل شيئاً
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save reading' }));

    await screen.findByText('The reading was saved.');
    expect(writes()).toHaveLength(1);
    const body = world.posts[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ fuel_station_id: ST, fuel_tank_id: T1, reading_type: 'physical', quantity_liters: '150.5', evidence: { method: 'dipstick', note: 'after unloading' } });
    expect(String(body.evidence_key)).toMatch(/^awj-ops-/);
    expect(body).not.toHaveProperty('measured_at');
    expect(body).not.toHaveProperty('recorded_at');

    // يُحدَّث المستوى والسجل من الخادم
    await waitFor(() => expect(screen.getAllByText(/150\.500/).length).toBeGreaterThan(0));
    expect(await screen.findByText(/Recorded by Sup Visor/, { selector: '[data-history-row] p' })).toBeTruthy();
  });

  it('blocks malformed and over-capacity quantities before any request, and warns above the safe capacity without blocking', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    connect(build());
    renderOps(<TankDetailScreen id={T1} />);

    await openForm(user, '1.5.5');
    expect(await screen.findByText(/The quantity is not valid/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review and save' }) as HTMLButtonElement).disabled).toBe(true);
    await openForm(user, '200.001');
    expect(await screen.findByText(/above the tank capacity \(200\.000 L\)/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Review and save' }) as HTMLButtonElement).disabled).toBe(true);
    await openForm(user, '195');
    expect((await screen.findAllByText('Above safe capacity')).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Review and save' }) as HTMLButtonElement).disabled).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it('sends exactly one request however many times the confirm button is hit', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    connect(build());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    world.beforePost = () => undefined;
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path, init) => {
      if ((init as { method?: string } | undefined)?.method === 'POST') await gate;
      return original(path, init as never);
    });
    renderOps(<TankDetailScreen id={T1} />);

    await openForm(user, '120');
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Save reading' });
    await user.click(confirm);
    await user.click(within(dialog).getByRole('button', { name: /Saving/ }));
    await user.click(within(dialog).getByRole('button', { name: /Saving/ }));
    release();
    await screen.findByText('The reading was saved.');
    expect(writes()).toHaveLength(1);
    expect(world.readings).toHaveLength(1);
  });

  it('after a lost reply it does not claim failure or resend: “check” finds the saved reading by its key', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    let drop = true;
    connect(build({ dropReplyAfterApply: () => { const now = drop; drop = false; return now; } }));
    renderOps(<TankDetailScreen id={T1} />);

    await openForm(user, '120');
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));

    const notice = await screen.findByRole('alert');
    expect(notice.getAttribute('data-failure')).toBe('unknown');
    expect(world.readings).toHaveLength(1); // الخادم حفظها فعلاً
    await user.click(within(notice).getByRole('button', { name: /Check/i }));
    await screen.findByText('The reading was saved.');
    expect(writes()).toHaveLength(1); // لا إعادة إرسال
  });

  it('when the check finds nothing it says so, and a resend reuses the same key so the server cannot duplicate', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    let fail = true;
    connect(build({ beforePost: () => { if (fail) { fail = false; throw new TypeError('Failed to fetch'); } } }));
    renderOps(<TankDetailScreen id={T1} />);

    await openForm(user, '120');
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));
    const notice = await screen.findByRole('alert');
    await user.click(within(notice).getByRole('button', { name: /Check/i }));
    expect(await screen.findByText(/was not found in the log, so it was not saved/)).toBeTruthy();
    expect(world.readings).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));
    await screen.findByText('The reading was saved.');
    expect(world.posts).toHaveLength(2);
    expect(world.posts[0].body.evidence_key).toBe(world.posts[1].body.evidence_key);
    expect(world.readings).toHaveLength(1);
  });

  it('a different quantity is a new intent with a new key', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    let fail = true;
    connect(build({ beforePost: () => { if (fail) { fail = false; throw new TypeError('Failed to fetch'); } } }));
    renderOps(<TankDetailScreen id={T1} />);
    await openForm(user, '120');
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));
    await screen.findByRole('alert');
    await openForm(user, '121');
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));
    await screen.findByText('The reading was saved.');
    expect(world.posts[0].body.evidence_key).not.toBe(world.posts[1].body.evidence_key);
  });

  it('shows a server rejection as final (nothing saved) and keeps the typed values', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    // الخادم يرفض فوق السعة؛ نتجاوز حجب الواجهة بتصغير سعة الخزان بعد التحميل
    connect(build());
    renderOps(<TankDetailScreen id={T2} />);
    await openForm(user, '99');
    world.tanks[1].capacity = 50_000;
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));
    const notice = await screen.findByRole('alert');
    expect(notice.getAttribute('data-failure')).toBe('rejected');
    expect(notice.textContent).toMatch(/above the approved tank capacity/);
    expect((screen.getByTestId('tank-quantity') as HTMLInputElement).value).toBe('99');
    expect(world.readings).toHaveLength(0);
  });

  it('does not send while offline and keeps the entered values', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    connect(build());
    renderOps(<TankDetailScreen id={T1} />);
    await openForm(user, '120');
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));
    const notice = await screen.findByRole('alert');
    expect(notice.getAttribute('data-failure')).toBe('not_sent');
    expect(writes()).toHaveLength(0);
    expect((screen.getByTestId('tank-quantity') as HTMLInputElement).value).toBe('120');
  });

  it('keeps the ATG source honest: manual entry from the console, no device link', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    connect(build());
    renderOps(<TankDetailScreen id={T1} />);
    await user.click((await screen.findAllByRole('radio', { name: 'ATG reading entered manually' }))[0]);
    expect(screen.getByText(/no direct device connection/)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Dipstick' })).toBeNull();
    await openForm(user, '130');
    await user.click(screen.getByRole('button', { name: 'Review and save' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save reading' }));
    await screen.findByText('The reading was saved.');
    expect(world.posts[0].body).toMatchObject({ reading_type: 'atg', evidence: { method: 'atg_console' } });
  });
});

describe('permissions and scope', () => {
  it('lets a seller see the monitor and the log but offers no recording', async () => {
    seedUser(SELLER);
    connect(build({ readings: [stored('r1', T1, 'physical', 150_000, '2026-11-06T09:00:00+00:00')] }));
    renderOps(<TankDetailScreen id={T1} />);
    expect(await screen.findByText(/do not have permission to record readings/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review and save' })).toBeNull();
    expect(screen.getByText(/Recorded by Other Person/, { selector: '[data-history-row] p' })).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('treats a tank outside the station as not found and sends no request for the form', async () => {
    seedUser(SUPERVISOR);
    connect(build());
    renderOps(<TankDetailScreen id="00000000-0000-4000-8000-0000000000ff" />);
    expect(await screen.findByText(/not available|not found|no access/i)).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it('pages the log newest first and filters by type', async () => {
    const user = userEvent.setup();
    seedUser(SUPERVISOR);
    const many = Array.from({ length: 12 }, (_, i) => stored(`r${i + 1}`, T1, i % 2 ? 'atg' : 'physical', 10_000 + i * 1000, `2026-11-06T0${Math.floor(i / 2)}:${i % 2 ? '30' : '00'}:00+00:00`.replace(/T0(1\d)/, 'T$1')));
    connect(build({ readings: many }));
    renderOps(<TankDetailScreen id={T1} />);
    await screen.findByText('Reading log');
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]').length).toBe(10));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]').length).toBe(2));
    await user.click(screen.getAllByRole('radio', { name: 'ATG reading entered manually' }).at(-1) as HTMLElement);
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]').length).toBe(6));
  });
});
